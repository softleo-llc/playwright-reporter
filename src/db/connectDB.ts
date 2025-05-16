import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure the database directory exists
const DB_DIR = path.join(process.cwd(), 'database');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, {recursive: true});
}

const DB_PATH = path.join(DB_DIR, 'reporter.db');

/**
 * Establishes and returns a connection to the SQLite database
 */
export function connectDB(): sqlite3.Database {
    const db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            console.error('Error connecting to the database:', err);
        } else {
            console.log('Connected to the SQLite database at:', DB_PATH);
        }
    });

    // Enable foreign keys support
    db.run('PRAGMA foreign_keys = ON');

    return db;
}
