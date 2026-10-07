#!/bin/sh
set -e

mkdir -p /run/postgresql
chown -R postgres:postgres /run/postgresql

mkdir -p /run/shm/pgdata
chown -R postgres:postgres /run/shm/pgdata

if [ ! -f /run/shm/pgdata/PG_VERSION ]; then
    su - postgres -c 'initdb -D /run/shm/pgdata -U postgres --auth=trust'
    sed -i '/listen_addresses/d' /run/shm/pgdata/postgresql.conf
    echo "listen_addresses = '*'" >> /run/shm/pgdata/postgresql.conf
    echo "host all all 0.0.0.0/0 trust" >> /run/shm/pgdata/pg_hba.conf
    echo "host all all ::0/0 trust" >> /run/shm/pgdata/pg_hba.conf
fi

# Start PostgreSQL if not already running
if ! su - postgres -c 'pg_isready' > /dev/null 2>&1; then
    su - postgres -c 'pg_ctl -D /run/shm/pgdata -l /run/shm/pgdata/logfile start'
fi

# Wait until postgres is ready
until su - postgres -c 'pg_isready'; do
    sleep 1
done

# Create user and database
su - postgres -c "psql -c \"CREATE USER casino_admin WITH PASSWORD 'supersecretpassword' SUPERUSER;\"" || true
su - postgres -c "psql -c \"CREATE DATABASE casino_core OWNER casino_admin;\"" || true
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE casino_core TO casino_admin;\"" || true

# Start Redis if not already running
if ! redis-cli ping > /dev/null 2>&1; then
    mkdir -p /run/shm/redis
    redis-server --daemonize yes --dir /run/shm/redis --bind 0.0.0.0 --port 6379 --protected-mode no
fi

echo "PostgreSQL and Redis are up and running!"
