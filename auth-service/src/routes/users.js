const express = require('express');
const { query } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all users (admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE is_active = true';
    let queryParams = [];
    let paramCount = 1;

    if (search) {
      whereClause += ` AND (name ILIKE $${paramCount} OR family_name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    // Get users
    const usersResult = await query(
      `SELECT id, email, name, family_name, gender, date_of_birth, created_at, updated_at
       FROM global_users 
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...queryParams, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM global_users ${whereClause}`,
      queryParams
    );

    const total = parseInt(countResult.rows[0].total);

    res.json({
      users: usersResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Failed to get users:', error);
    res.status(500).json({
      error: 'Failed to get users'
    });
  }
});

// Get user by ID
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user is admin or requesting their own profile
    if (!req.user.roles.includes('admin') && req.user.id !== userId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only view your own profile'
      });
    }

    const result = await query(
      `SELECT id, email, name, family_name, gender, date_of_birth, created_at, updated_at
       FROM global_users 
       WHERE id = $1 AND is_active = true`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      user: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Failed to get user:', error);
    res.status(500).json({
      error: 'Failed to get user'
    });
  }
});

// Get user's projects
router.get('/:userId/projects', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user is admin or requesting their own projects
    if (!req.user.roles.includes('admin') && req.user.id !== userId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only view your own projects'
      });
    }

    const result = await query(
      `SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
              pp.permission_type, pp.granted_at, pp.expires_at
       FROM projects p
       LEFT JOIN project_permissions pp ON p.id = pp.project_id
       WHERE (p.owner_id = $1 OR pp.user_id = $1) AND p.is_active = true
       ORDER BY p.created_at DESC`,
      [userId]
    );

    res.json({
      projects: result.rows
    });

  } catch (error) {
    console.error('❌ Failed to get user projects:', error);
    res.status(500).json({
      error: 'Failed to get user projects'
    });
  }
});

// Deactivate user (admin only)
router.delete('/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent admin from deactivating themselves
    if (req.user.id === userId) {
      return res.status(400).json({
        error: 'Cannot deactivate yourself'
      });
    }

    const result = await query(
      `UPDATE global_users 
       SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND is_active = true
       RETURNING id, email, name`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found or already deactivated'
      });
    }

    const user = result.rows[0];

    // Log the deactivation
    await query(
      `INSERT INTO audit_logs (user_id, action, resource_type, details)
       VALUES ($1, 'user_deactivated', 'user', $2)`,
      [req.user.id, JSON.stringify({ deactivated_user: user.email })]
    );

    res.json({
      message: 'User deactivated successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });

  } catch (error) {
    console.error('❌ Failed to deactivate user:', error);
    res.status(500).json({
      error: 'Failed to deactivate user'
    });
  }
});

// Reactivate user (admin only)
router.post('/:userId/reactivate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await query(
      `UPDATE global_users 
       SET is_active = true, updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, name`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    // Log the reactivation
    await query(
      `INSERT INTO audit_logs (user_id, action, resource_type, details)
       VALUES ($1, 'user_reactivated', 'user', $2)`,
      [req.user.id, JSON.stringify({ reactivated_user: user.email })]
    );

    res.json({
      message: 'User reactivated successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });

  } catch (error) {
    console.error('❌ Failed to reactivate user:', error);
    res.status(500).json({
      error: 'Failed to reactivate user'
    });
  }
});

module.exports = router;