const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, checkProjectAccess } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Get all projects for current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = `WHERE (p.owner_id = $1 OR pp.user_id = $1) AND p.is_active = true`;
    let queryParams = [req.user.id];
    let paramCount = 2;

    if (search) {
      whereClause += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    // Get projects
    const projectsResult = await query(
      `SELECT DISTINCT p.id, p.name, p.description, p.owner_id, p.created_at, p.updated_at,
              CASE WHEN p.owner_id = $1 THEN 'admin' ELSE pp.permission_type END as permission_type
       FROM projects p
       LEFT JOIN project_permissions pp ON p.id = pp.project_id AND pp.user_id = $1
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...queryParams, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(DISTINCT p.id) as total 
       FROM projects p
       LEFT JOIN project_permissions pp ON p.id = pp.project_id AND pp.user_id = $1
       ${whereClause}`,
      queryParams
    );

    const total = parseInt(countResult.rows[0].total);

    res.json({
      projects: projectsResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Failed to get projects:', error);
    res.status(500).json({
      error: 'Failed to get projects'
    });
  }
});

// Create new project
router.post('/', authenticateToken, [
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('description').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { name, description } = req.body;

    // Generate unique database name and credentials
    const dbName = `project_${uuidv4().replace(/-/g, '')}`;
    const dbUser = `user_${uuidv4().replace(/-/g, '')}`;
    const dbPassword = uuidv4().replace(/-/g, '');

    // Create project in database
    const result = await query(
      `INSERT INTO projects (name, description, owner_id, database_name, database_user, database_password)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, created_at`,
      [name, description, req.user.id, dbName, dbUser, dbPassword]
    );

    const project = result.rows[0];

    // Create actual database
    const createDbResult = await query(
      'SELECT create_project_database($1, $2, $3, $4)',
      [name, dbName, dbUser, dbPassword]
    );

    if (!createDbResult.rows[0].create_project_database) {
      // Rollback project creation if database creation failed
      await query('DELETE FROM projects WHERE id = $1', [project.id]);
      return res.status(500).json({
        error: 'Failed to create project database'
      });
    }

    // Log the project creation
    await query(
      `INSERT INTO audit_logs (user_id, project_id, action, resource_type, details)
       VALUES ($1, $2, 'project_created', 'project', $3)`,
      [req.user.id, project.id, JSON.stringify({ name, description, dbName })]
    );

    res.status(201).json({
      message: 'Project created successfully',
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        created_at: project.created_at,
        database: {
          name: dbName,
          user: dbUser,
          password: dbPassword
        }
      }
    });

  } catch (error) {
    console.error('❌ Failed to create project:', error);
    res.status(500).json({
      error: 'Failed to create project'
    });
  }
});

// Get project details
router.get('/:projectId', authenticateToken, checkProjectAccess('read'), async (req, res) => {
  try {
    const { projectId } = req.params;

    const result = await query(
      `SELECT p.id, p.name, p.description, p.owner_id, p.created_at, p.updated_at,
              u.name as owner_name, u.email as owner_email
       FROM projects p
       JOIN global_users u ON p.owner_id = u.id
       WHERE p.id = $1 AND p.is_active = true`,
      [projectId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Project not found'
      });
    }

    const project = result.rows[0];

    // Get project permissions
    const permissionsResult = await query(
      `SELECT pp.id, pp.permission_type, pp.granted_at, pp.expires_at,
              u.name as user_name, u.email as user_email
       FROM project_permissions pp
       JOIN global_users u ON pp.user_id = u.id
       WHERE pp.project_id = $1 AND pp.expires_at > NOW()
       ORDER BY pp.granted_at DESC`,
      [projectId]
    );

    res.json({
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        owner: {
          id: project.owner_id,
          name: project.owner_name,
          email: project.owner_email
        },
        created_at: project.created_at,
        updated_at: project.updated_at,
        permissions: permissionsResult.rows
      }
    });

  } catch (error) {
    console.error('❌ Failed to get project:', error);
    res.status(500).json({
      error: 'Failed to get project'
    });
  }
});

// Update project
router.put('/:projectId', authenticateToken, checkProjectAccess('admin'), [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('description').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { projectId } = req.params;
    const { name, description } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'No fields to update'
      });
    }

    values.push(projectId);

    const result = await query(
      `UPDATE projects 
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount} AND is_active = true
       RETURNING id, name, description, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Project not found'
      });
    }

    const project = result.rows[0];

    // Log the update
    await query(
      `INSERT INTO audit_logs (user_id, project_id, action, resource_type, details)
       VALUES ($1, $2, 'project_updated', 'project', $3)`,
      [req.user.id, projectId, JSON.stringify({ name, description })]
    );

    res.json({
      message: 'Project updated successfully',
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        updated_at: project.updated_at
      }
    });

  } catch (error) {
    console.error('❌ Failed to update project:', error);
    res.status(500).json({
      error: 'Failed to update project'
    });
  }
});

// Grant project access to user
router.post('/:projectId/permissions', authenticateToken, checkProjectAccess('admin'), [
  body('user_email').isEmail().normalizeEmail(),
  body('permission_type').isIn(['read', 'write', 'admin']),
  body('expires_at').optional().isISO8601().toDate()
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { projectId } = req.params;
    const { user_email, permission_type, expires_at } = req.body;

    // Get user by email
    const userResult = await query(
      'SELECT id FROM global_users WHERE email = $1 AND is_active = true',
      [user_email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const userId = userResult.rows[0].id;

    // Check if permission already exists
    const existingPermission = await query(
      'SELECT id FROM project_permissions WHERE user_id = $1 AND project_id = $2',
      [userId, projectId]
    );

    if (existingPermission.rows.length > 0) {
      return res.status(409).json({
        error: 'Permission already exists',
        message: 'User already has access to this project'
      });
    }

    // Create permission
    const result = await query(
      `INSERT INTO project_permissions (user_id, project_id, permission_type, granted_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, permission_type, granted_at, expires_at`,
      [userId, projectId, permission_type, req.user.id, expires_at]
    );

    const permission = result.rows[0];

    // Log the permission grant
    await query(
      `INSERT INTO audit_logs (user_id, project_id, action, resource_type, details)
       VALUES ($1, $2, 'permission_granted', 'permission', $3)`,
      [req.user.id, projectId, JSON.stringify({ 
        target_user: user_email, 
        permission_type, 
        expires_at 
      })]
    );

    res.status(201).json({
      message: 'Permission granted successfully',
      permission: {
        id: permission.id,
        permission_type: permission.permission_type,
        granted_at: permission.granted_at,
        expires_at: permission.expires_at
      }
    });

  } catch (error) {
    console.error('❌ Failed to grant permission:', error);
    res.status(500).json({
      error: 'Failed to grant permission'
    });
  }
});

// Delete project
router.delete('/:projectId', authenticateToken, checkProjectAccess('admin'), async (req, res) => {
  try {
    const { projectId } = req.params;

    // Get project details for logging
    const projectResult = await query(
      'SELECT name, database_name FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Project not found'
      });
    }

    const project = projectResult.rows[0];

    // Soft delete project
    await query(
      'UPDATE projects SET is_active = false, updated_at = NOW() WHERE id = $1',
      [projectId]
    );

    // Log the deletion
    await query(
      `INSERT INTO audit_logs (user_id, project_id, action, resource_type, details)
       VALUES ($1, $2, 'project_deleted', 'project', $3)`,
      [req.user.id, projectId, JSON.stringify({ 
        project_name: project.name, 
        database_name: project.database_name 
      })]
    );

    res.json({
      message: 'Project deleted successfully'
    });

  } catch (error) {
    console.error('❌ Failed to delete project:', error);
    res.status(500).json({
      error: 'Failed to delete project'
    });
  }
});

module.exports = router;