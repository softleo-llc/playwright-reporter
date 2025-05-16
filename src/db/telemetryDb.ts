import {connectDB} from './connectDB';
import sqlite3 from 'sqlite3';

export class TelemetryDb {
    private db = connectDB();

    public initializeTables() {
        this.db.serialize(() => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS testrun (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT,
                    total_tests INTEGER,
                    passed INTEGER,
                    failed INTEGER,
                    skipped INTEGER,
                    pass_rate REAL,
                    duration TEXT,
                    status TEXT,
                    date TEXT,
                    run_start TEXT,
                    run_end TEXT,
                    build_id TEXT,
                    build_number TEXT,
                    build_branch TEXT,
                    build_repository TEXT,
                    commit_id TEXT,
                    build_link TEXT,
                    artifacts_link TEXT,
                    test_link TEXT,
                    os TEXT,
                    browser TEXT,
                    headless INTEGER
                )
            `);

            this.db.run(`
                CREATE TABLE IF NOT EXISTS testresults (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    testrun_id INTEGER,
                    test_id TEXT,
                    test_title TEXT,
                    suite_title TEXT,
                    file_path TEXT,
                    status TEXT,
                    outcome TEXT,
                    duration REAL,
                    retries INTEGER,
                    error_message TEXT,
                    error_stack TEXT,
                    is_timeout INTEGER,
                    error_category TEXT,
                    owner TEXT,
                    artifacts TEXT,
                    location TEXT,
                    FOREIGN KEY (testrun_id) REFERENCES testrun(id)
                )
            `);

            this.db.run(`
                CREATE TABLE IF NOT EXISTS ado_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_name TEXT,
                    event_type TEXT,
                    message TEXT,
                    properties TEXT,
                    timestamp TEXT
                )
            `);
        });
    }

    public insertTestRun(run: {
        name: string;
        total_tests: number;
        passed: number;
        failed: number;
        skipped: number;
        pass_rate: number;
        duration: string;
        status: string;
        date: string;
        run_start: string;
        run_end: string;
        build_id?: string;
        build_number?: string;
        build_branch?: string;
        build_repository?: string;
        commit_id?: string;
        build_link?: string;
        artifacts_link?: string;
        test_link?: string;
        os: string;
        browser: string;
        headless: boolean;
    }): Promise<number> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO testrun (
                    name, total_tests, passed, failed, skipped, pass_rate, duration, status, date,
                    run_start, run_end, build_id, build_number, build_branch, build_repository, commit_id,
                    build_link, artifacts_link, test_link, os, browser, headless
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

                [
                    run.name,
                    run.total_tests,
                    run.passed,
                    run.failed,
                    run.skipped,
                    run.pass_rate,
                    run.duration,
                    run.status,
                    run.date,
                    run.run_start,
                    run.run_end,
                    run.build_id ?? '',
                    run.build_number ?? '',
                    run.build_branch ?? '',
                    run.build_repository ?? '',
                    run.commit_id ?? '',
                    run.build_link ?? '',
                    run.artifacts_link ?? '',
                    run.test_link ?? '',
                    run.os,
                    run.browser,
                    run.headless ? 1 : 0,
                ],
                function (this: sqlite3.RunResult, err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                },
            );
        });
    }

    public insertTestResult(result: {
        testrun_id: number;
        test_id?: string;
        test_title: string;
        suite_title: string;
        file_path?: string;
        status?: string;
        outcome?: string;
        duration?: number;
        retries?: number;
        error_message?: string;
        error_stack?: string;
        is_timeout?: boolean;
        error_category?: string;
        owner?: string;
        artifacts?: any;
        location?: any;
    }): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO testresults (
                    testrun_id, test_id, test_title, suite_title, file_path, status, outcome, 
                    duration, retries, error_message, error_stack, is_timeout, error_category, 
                    owner, artifacts, location
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

                [
                    result.testrun_id,
                    result.test_id ?? '',
                    result.test_title,
                    result.suite_title,
                    result.file_path ?? '',
                    result.status ?? '',
                    result.outcome ?? '',
                    result.duration ?? 0,
                    result.retries ?? 0,
                    result.error_message ?? '',
                    result.error_stack ?? '',
                    result.is_timeout ? 1 : 0,
                    result.error_category ?? '',
                    result.owner ?? '',
                    result.artifacts ? JSON.stringify(result.artifacts) : '',
                    result.location ? JSON.stringify(result.location) : '',
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                },
            );
        });
    }

    public logAdoOperation(log: {
        eventName: string;
        eventType: 'info' | 'success' | 'error';
        message?: string;
        properties?: Record<string, any>;
    }): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO ado_logs (
                    event_name, event_type, message, properties, timestamp
                ) VALUES (?, ?, ?, ?, ?)`,
                [
                    log.eventName,
                    log.eventType,
                    log.message ?? '',
                    log.properties ? JSON.stringify(log.properties) : '',
                    new Date().toISOString(),
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                },
            );
        });
    }
}
