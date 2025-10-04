const { verifyToken } = require('../config/keycloak');
const { query } = require('../config/database');

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
    
    // Get user from database
    const userResult = await query(
      'SELECT * FROM global_users WHERE keycloak_id = $1 AND is_active = true',
      [decoded.sub]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ 
        error: 'Access denied', 
        message: 'User not found or inactive' 
      });
    }

    // Add user info to request
    req.user = {
      id: userResult.rows[0].id,
      keycloakId: decoded.sub,
      email: decoded.email,
      name: userResult.rows[0].name,
      familyName: userResult.rows[0].family_name,
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

// Middleware to check if user has project access
const checkProjectAccess = (permissionType = 'read') => {
  return async (req, res, next) => {
    try {
      const projectId = req.params.projectId || req.body.projectId;
      
      if (!projectId) {
        return res.status(400).json({ 
          error: 'Bad request', 
          message: 'Project ID is required' 
        });
      }

      // Check if user has access to the project
      const accessResult = await query(
        `SELECT pp.permission_type, p.owner_id 
         FROM project_permissions pp 
         JOIN projects p ON pp.project_id = p.id 
         WHERE pp.user_id = $1 AND pp.project_id = $2 AND pp.expires_at > NOW()`,
        [req.user.id, projectId]
      );

      // Check if user is project owner
      const isOwner = accessResult.rows.length > 0 && 
                     accessResult.rows[0].owner_id === req.user.id;

      // Check permission level
      const hasPermission = accessResult.rows.length > 0 && 
                           (accessResult.rows[0].permission_type === 'admin' ||
                            (permissionType === 'write' && accessResult.rows[0].permission_type === 'write') ||
                            (permissionType === 'read' && ['read', 'write', 'admin'].includes(accessResult.rows[0].permission_type)));

      if (!hasPermission && !isOwner) {
        return res.status(403).json({ 
          error: 'Access denied', 
          message: `Insufficient permissions for project access` 
        });
      }

      req.projectAccess = {
        permissionType: accessResult.rows[0]?.permission_type || 'admin',
        isOwner
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

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (!req.user.roles.includes('admin')) {
    return res.status(403).json({ 
      error: 'Access denied', 
      message: 'Admin role required' 
    });
  }
  next();
};

module.exports = {
  authenticateToken,
  checkProjectAccess,
  requireAdmin
};