import {TestResult, Location} from '@playwright/test/reporter';

/**
 * Represents information about a single test attempt.
 * This includes the test status, duration, and any errors that occurred.
 */
export interface AttemptInfo {
    /** The final status of the test attempt (passed, failed, skipped, etc.) */
    status: TestResult['status'];
    /** Duration of the test attempt in seconds */
    duration: number;
    /** Array of errors that occurred during the test attempt */
    errors: TestError[];
}

/**
 * Represents an error that occurred during test execution.
 */
export interface TestError {
    /** The error message */
    message: string;
    /** Optional stack trace of the error */
    stack?: string;
}

/**
 * Enhanced representation of a TestCase with additional metadata.
 * Uses composition instead of extension to avoid type conflicts.
 */
export interface TestCaseDetails {
    testId?: string;
    /** Title of the test case */
    testTitle: string;
    /** Title of the test suite containing this test */
    suiteTitle: string;
    /** File path of the test file */
    testFile?: string;
    /** Status of the test case */
    status?: string;
    /** Outcome of the test case */
    outcome?: string;
    /** owning team of the test */
    owningTeam?: string;
    /** Time taken by the failed test in seconds */
    duration?: number;
    /** Location information of the test in the source code */
    location?: Location;
}

/**
 * Represents a complete record of a test case and all its attempts.
 * This is used to track retries and maintain test history.
 */
export interface TestRecord {
    /** The test case being tracked */
    test: TestCaseDetails;
    /** Array of all attempts made to run this test */
    attempts: AttemptInfo[];
}

/**
 * Represents a complete summary of the test run results.
 * This includes statistics about passed, failed, and skipped tests,
 * as well as timing information.
 */
export interface TestSummary {
    /** Name of the test run */
    testRunName: string;
    /** Start time of the test run */
    testRunStartTime?: number;
    /** End time of the test run */
    testRunEndTime?: number;
    /** Total duration of the test run in seconds */
    totalDuration: number;
    /** Browser used for test run */
    browserName?: string;
    /** Headless mode used for test run */
    headless?: boolean;
    /** OS of the agent */
    os?: string;
    /** Total number of tests executed */
    testCount: number;
    /** Number of tests that passed */
    passedCount: number;
    /** Number of tests that were skipped */
    skippedCount: number;
    /** Number of tests that failed */
    failedCount: number;
    /** Pass rate of the test run */
    passRate: number;
    /** Status of the test run (passed, failed, etc.) */
    status: string;
    /** Formatted string of total test execution time */
    totalTimeDisplay: string;
    /** Average time taken by passed tests */
    averageTime: number;
    /** Duration of the slowest test in seconds */
    slowestTest: number;
    /** Array of the slowest tests with their durations */
    slowestTests: SlowTest[];
    /** Information about the build environment */
    buildInfo?: BuildInfo;
    /** Array of test failures with detailed information */
    failures: TestFailure[];
}

/**
 * Represents information about the build environment
 */
export interface BuildInfo {
    /** Whether the test was run in a CI environment */
    isPipeline: boolean;
    /** Name of the CI system (Azure Pipelines, GitHub Actions, etc.) */
    executionSystem?: string;
    /** Link to build artifacts */
    artifactsLink?: string;
    /** Link to build results */
    buildLink?: string;
    /** Build identifier */
    buildId?: string;
    /** Build number */
    buildNumber?: string;
    /** Branch name */
    buildBranch?: string;
    /** Repository name */
    buildRepository?: string;
    /** Commit identifier */
    commitId?: string;
    /** Link to commit */
    commitLink?: string;
    /** Link to test results */
    testResultLink?: string;
    /** type of pipeline */
    pipelineType?: string; // PR, CI, or scheduled
    /** Schedule details if pipelineType is 'Schedule' */
    scheduleDetails?: string;
    /** Start time of the pipeline */
    pipelineStartTime?: string;
    /** End time of the pipeline */
    pipelineEndTime?: string;
}

/**
 * Represents detailed information about a test failure.
 * Extends TestCaseDetails to include failure-specific information.
 */
export interface TestFailure extends TestCaseDetails {
    /** Error message from the failure */
    errorMessage: string;
    /** Stack trace of the failure */
    errorStack: string;
    /** Whether the failure was due to a timeout */
    isTimeout: boolean;
    /** Category of the error (ElementNotFound, Timeout/DelayedElement, SelectorChanged, etc.) */
    errorCategory: string;
}

/**
 * Represents information about a slow test.
 * Used for reporting tests that took longer than expected.
 */
export interface SlowTest {
    /** Title of the slow test */
    testTitle: string;
    /** Duration of the test in seconds */
    duration: number;
}
