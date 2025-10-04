# 🚀 Project Bistun - Global Database System

A Supabase-like platform with Keycloak authentication and PostgreSQL for microservices.

## 🏗️ Architecture

- **Global Authentication**: Keycloak SSO for all microservices
- **Centralized User Management**: PostgreSQL with global user profiles
- **Project-based Databases**: Each microservice gets its own isolated database
- **Unified API Gateway**: Single entry point for all services

## 🚀 Quick Start

```bash
# Clone and start the system
git clone <your-repo>
cd project-bistun

# Start all services
docker-compose up -d

# Access services:
# - Keycloak Admin: http://localhost:8080 (admin/admin123)
# - Admin Dashboard: http://localhost:3000
# - Auth Service: http://localhost:3001
# - DB Gateway: http://localhost:3002
# - PostgreSQL: localhost:5432
```

## 📁 Project Structure

```
project-bistun/
├── docker-compose.yml          # All services orchestration
├── keycloak/                   # Keycloak configuration
├── postgres/                   # PostgreSQL setup & migrations
├── auth-service/               # Global auth service
├── db-gateway/                 # Database proxy/gateway
├── admin-dashboard/            # Management interface
├── sdk/                        # Client libraries
├── examples/                   # Sample microservices
└── docs/                       # Documentation
```

## 🔧 Services

### Keycloak (Port 8080)
- Authentication server
- User management
- JWT token generation
- SSO configuration

### Auth Service (Port 3001)
- Global authentication API
- User profile management
- Project access control
- JWT validation

### DB Gateway (Port 3002)
- Database routing
- Query proxy
- Connection pooling
- Security enforcement

### Admin Dashboard (Port 3000)
- User management
- Project creation
- System monitoring
- Configuration

### PostgreSQL (Port 5432)
- Global user database
- Project databases
- Data isolation
- Backup/restore

## 🛠️ Development

### Adding a New Microservice

1. Create project in admin dashboard
2. Get database credentials
3. Use SDK to connect
4. Start building!

### SDK Usage

```javascript
import { BistunClient } from '@bistun/sdk';

const client = new BistunClient({
  authUrl: 'http://localhost:3001',
  dbUrl: 'http://localhost:3002',
  projectId: 'your-project-id'
});

// Authenticate user
await client.auth.login('user@example.com', 'password');

// Query your project database
const users = await client.db.query('SELECT * FROM users');
```

## 🔐 Security

- JWT-based authentication
- Row-level security (RLS)
- Network isolation
- Encrypted communications
- Audit logging

## 📊 Monitoring

- Prometheus metrics
- Grafana dashboards
- Application logs
- Performance monitoring

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Submit pull request

## 📄 License

MIT License - see LICENSE file for details