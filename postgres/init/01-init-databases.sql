-- Create Keycloak database
CREATE DATABASE keycloak;

-- Create user for Keycloak
CREATE USER keycloak WITH PASSWORD 'keycloak123';
GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;

-- Create global Bistun database schema
\c bistun_global;

-- Global users table
CREATE TABLE global_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keycloak_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    family_name VARCHAR(255) NOT NULL,
    gender VARCHAR(50),
    date_of_birth DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

-- Projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id UUID REFERENCES global_users(id),
    database_name VARCHAR(255) UNIQUE NOT NULL,
    database_user VARCHAR(255) NOT NULL,
    database_password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

-- Project permissions table
CREATE TABLE project_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES global_users(id),
    project_id UUID REFERENCES projects(id),
    permission_type VARCHAR(50) NOT NULL CHECK (permission_type IN ('read', 'write', 'admin')),
    granted_by UUID REFERENCES global_users(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, project_id)
);

-- Audit logs table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES global_users(id),
    project_id UUID REFERENCES projects(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_global_users_keycloak_id ON global_users(keycloak_id);
CREATE INDEX idx_global_users_email ON global_users(email);
CREATE INDEX idx_projects_owner_id ON projects(owner_id);
CREATE INDEX idx_project_permissions_user_id ON project_permissions(user_id);
CREATE INDEX idx_project_permissions_project_id ON project_permissions(project_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_project_id ON audit_logs(project_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_global_users_updated_at BEFORE UPDATE ON global_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to create project database
CREATE OR REPLACE FUNCTION create_project_database(project_name VARCHAR, db_name VARCHAR, db_user VARCHAR, db_password VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
    query TEXT;
BEGIN
    -- Create database
    query := 'CREATE DATABASE ' || quote_ident(db_name);
    EXECUTE query;
    
    -- Create user
    query := 'CREATE USER ' || quote_ident(db_user) || ' WITH PASSWORD ' || quote_literal(db_password);
    EXECUTE query;
    
    -- Grant privileges
    query := 'GRANT ALL PRIVILEGES ON DATABASE ' || quote_ident(db_name) || ' TO ' || quote_ident(db_user);
    EXECUTE query;
    
    RETURN TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Insert default admin user (will be synced with Keycloak)
INSERT INTO global_users (keycloak_id, email, name, family_name, gender, date_of_birth) 
VALUES ('admin', 'admin@bistun.local', 'Admin', 'User', 'other', '1990-01-01');

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO bistun_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO bistun_admin;