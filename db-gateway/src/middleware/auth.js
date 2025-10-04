const { verifyToken } = require('../config/keycloak');
const { checkProjectAccess } = require('../config/database');

// Middleware to authenticate JWT tokens
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ 
        error: 'Access denied', 
        message: 'No token provided' 
      });
    }

    // Verify token with Keycloak
    const decoded = await verifyToken(token);
    
    // Add user info to request
    req.user = {
      keycloakId: decoded.sub,
      email: decoded.email,
      roles: decoded.realm_access?.roles || [],
      ...decoded
    };

    next();
  } catch (error) {
    console.error('❌ Token verification failed:', error);
    return res.status(403).json({ 
      error: 'Access denied', 
      message: 'Invalid token' 
    });
  }
};

// Middleware to check project access
const checkProjectAccessMiddleware = (permissionType = 'read') => {
  return async (req, res, next) => {
    try {
      const projectId = req.params.projectId || req.body.projectId;
      
      if (!projectId) {
        return res.status(400).json({ 
          error: 'Bad request', 
          message: 'Project ID is required' 
        });
      }

      // Get user ID from global database
      const { getGlobalPool } = require('../config/database');
      const globalPool = getGlobalPool();
      
      const userResult = await globalPool.query(
        'SELECT id FROM global_users WHERE keycloak_id = $1 AND is_active = true',
        [req.user.keycloakId]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ 
          error: 'Access denied', 
          message: 'User not found or inactive' 
        });
      }

      const userId = userResult.rows[0].id;

      // Check project access
      const access = await checkProjectAccess(userId, projectId);

      if (!access) {
        return res.status(403).json({ 
          error: 'Access denied', 
          message: 'No access to this project' 
        });
      }

      // Check permission level
      const hasPermission = access.permission_type === 'admin' ||
                          (permissionType === 'write' && access.permission_type === 'write') ||
                          (permissionType === 'read' && ['read', 'write', 'admin'].includes(access.permission_type));

      if (!hasPermission) {
        return res.status(403).json({ 
          error: 'Access denied', 
          message: `Insufficient permissions for ${permissionType} access` 
        });
      }

      req.user.id = userId;
      req.projectAccess = {
        permissionType: access.permission_type,
        isOwner: access.owner_id === userId
      };

      next();
    } catch (error) {
      console.error('❌ Project access check failed:', error);
      return res.status(500).json({ 
        error: 'Internal server error', 
        message: 'Failed to verify project access' 
      });
    }
  };
};

module.exports = {
  authenticateToken,
  checkProjectAccessMiddleware
};