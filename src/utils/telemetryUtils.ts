import os from 'os';
import {TelemetryDb} from '../db/telemetryDb';
import {TestSummary, TestCaseDetails, TestFailure} from '../types';

export async function pushToTelemetry(summary: TestSummary, testCases: TestCaseDetails[]) {
    const telemetryDb = new TelemetryDb();
    await telemetryDb.initializeTables();

    // Format date in a way suitable for database storage
    const currentDate = new Date().toISOString().split('T')[0];

    // Insert test run information
    const testRunId = await telemetryDb.insertTestRun({
        name: summary.testRunName,
        total_tests: summary.testCount,
        passed: summary.passedCount,
        failed: summary.failedCount,
        skipped: summary.skippedCount,
        pass_rate: summary.passRate,
        duration: String(summary.totalDuration),
        status: summary.status,
        date: currentDate,
        run_start: summary.testRunStartTime ? new Date(summary.testRunStartTime).toISOString() : '',
        run_end: summary.testRunEndTime ? new Date(summary.testRunEndTime).toISOString() : '',
        build_id: summary.buildInfo?.buildId,
        build_number: summary.buildInfo?.buildNumber,
        build_branch: summary.buildInfo?.buildBranch,
        build_repository: summary.buildInfo?.buildRepository,
        commit_id: summary.buildInfo?.commitId,
        build_link: summary.buildInfo?.buildLink,
        artifacts_link: summary.buildInfo?.artifactsLink,
        test_link: summary.buildInfo?.testResultLink,
        os: summary.os || os.platform(),
        browser: summary.browserName || 'Unknown',
        headless: summary.headless || false,
    });

    // Insert test results
    for (const testCase of testCases) {
        await telemetryDb.insertTestResult({
            testrun_id: testRunId,
            test_id: testCase.testId,
            test_title: testCase.testTitle,
            suite_title: testCase.suiteTitle,
            file_path: testCase.testFile,
            status: testCase.status,
            outcome: testCase.outcome,
            duration: testCase.duration,
            owner: testCase.owningTeam,
            location: testCase.location,
            // For failures, include additional error details
            error_message: isTestFailure(testCase) ? testCase.errorMessage : undefined,
            error_stack: isTestFailure(testCase) ? testCase.errorStack : undefined,
            is_timeout: isTestFailure(testCase) ? testCase.isTimeout : undefined,
            error_category: isTestFailure(testCase) ? testCase.errorCategory : undefined,
        });
    }
}

// Type guard to check if a TestCaseDetails is a TestFailure
function isTestFailure(test: TestCaseDetails): test is TestFailure {
    return (test as TestFailure).errorMessage !== undefined;
}
