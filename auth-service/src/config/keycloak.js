const axios = require('axios');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-client');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://localhost:8080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'bistun';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'bistun-auth-service';
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET;

// JWKS client for token verification
const client = jwksClient({
  jwksUri: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`,
  cache: true,
  cacheMaxAge: 600000, // 10 minutes
  rateLimit: true,
  jwksRequestsPerMinute: 5
});

// Get signing key for JWT verification
const getKey = (header, callback) => {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
};

// Verify JWT token
const verifyToken = (token) => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, {
      audience: KEYCLOAK_CLIENT_ID,
      issuer: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`,
      algorithms: ['RS256']
    }, (err, decoded) => {
      if (err) {
        reject(err);
      } else {
        resolve(decoded);
      }
    });
  });
};

// Get admin token for Keycloak API calls
const getAdminToken = async () => {
  try {
    const response = await axios.post(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, 
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'admin-cli',
        client_secret: KEYCLOAK_CLIENT_SECRET
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    return response.data.access_token;
  } catch (error) {
    console.error('❌ Failed to get admin token:', error.response?.data || error.message);
    throw error;
  }
};

// Create user in Keycloak
const createKeycloakUser = async (userData) => {
  try {
    const adminToken = await getAdminToken();
    
    const response = await axios.post(
      `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users`,
      {
        username: userData.email,
        email: userData.email,
        firstName: userData.name,
        lastName: userData.family_name,
        enabled: true,
        emailVerified: true,
        credentials: [{
          type: 'password',
          value: userData.password || 'tempPassword123',
          temporary: true
        }]
      },
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('❌ Failed to create Keycloak user:', error.response?.data || error.message);
    throw error;
  }
};

// Get user info from Keycloak
const getKeycloakUser = async (userId) => {
  try {
    const adminToken = await getAdminToken();
    
    const response = await axios.get(
      `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`,
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('❌ Failed to get Keycloak user:', error.response?.data || error.message);
    throw error;
  }
};

// Update user in Keycloak
const updateKeycloakUser = async (userId, userData) => {
  try {
    const adminToken = await getAdminToken();
    
    const response = await axios.put(
      `${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`,
      userData,
      {
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('❌ Failed to update Keycloak user:', error.response?.data || error.message);
    throw error;
  }
};

module.exports = {
  verifyToken,
  createKeycloakUser,
  getKeycloakUser,
  updateKeycloakUser,
  getAdminToken
};