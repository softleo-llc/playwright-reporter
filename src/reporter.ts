import {Reporter, TestCase, TestResult, FullConfig, Suite, FullResult} from '@playwright/test/reporter';
import {colors} from './colors';
import {TestRecord, TestSummary, TestCaseDetails, TestFailure} from './types';
import {TestUtils, Logger} from './utils/utils';
import {FileHandler} from './utils/fileHandlerUtils';
import {BuildInfoUtils} from './utils/buildInfoUtils';
import {GenAIUtils} from './utils/genaiUtils';
import * as path from 'path';
import * as fs from 'fs';
import os from 'os';
import * as NodeMailer from 'nodemailer';
import * as Handlebars from 'handlebars';
import {pushToTelemetry} from './utils/telemetryUtils';
import {createGithubBug, resolveGithubBug, GithubBugDetails, GithubContext} from './utils/githubUtils';
import {getTeamInfo, getOwningTeam, ITeamInfo} from './utils/teamUtils';
import {createWorkItem, closeWorkItem, WorkItemDetails, WorkItemType} from './utils/adoUtils';

/**
 * PlaywrightTestReporter is a modern, maintainable reporter for Playwright tests.
 * It provides detailed, colorized output of test results with comprehensive metrics
 * and configurable options for better visibility into test execution.
 *
 * Features:
 * - Colorized output for different test states (passed, failed, skipped, retried)
 * - Detailed metrics including test duration and slow test identification
 * - Configurable thresholds for slow tests and timeouts
 * - Comprehensive error reporting with stack traces
 * - Support for test retries with clear status indication
 * - Complete monitoring of all error types including setup/teardown errors
 * - JSON output files for CI integration and historical tracking
 */
export default class PlaywrightTestReporter implements Reporter {
    private suite!: Suite;

    private readonly testRecords = new Map<string, TestRecord>();
    private startTime: number = 0;
    private endTime: number = 0;
    private nonTestErrors: Error[] = [];
    private hasInterruptedTests: boolean = false;
    private fileHandler: FileHandler;

    private testRunName: string;
    private outputDir: string;
    private sendEmail: boolean;
    private slowTestThreshold: number;
    private maxSlowTestsToShow: number;
    private timeoutWarningThreshold: number;
    private showStackTrace: boolean;
    private generateFix: boolean;
    private attributes?: {emails?: string[]};
    private smtpUser?: string;
    private smtpPass?: string;
    private pushToTelemetry?: boolean;
    private browserName?: string;
    private headless?: boolean;
    private createBug?: boolean;
    private githubToken?: string;
    private adoToken?: string;
    private failedTests: {test: TestCase; result: TestResult}[] = [];
    private passStreaks: Map<string, number> = new Map();
    private bugUrls: Map<string, string> = new Map();

    /**
     * Creates a new instance of the PlaywrightTestReporter.
     *
     * @param options - Optional configuration object to customize reporter behavior
     */
    constructor(
        options: {
            testRunName?: string;
            slowTestThreshold?: number;
            maxSlowTestsToShow?: number;
            timeoutWarningThreshold?: number;
            showStackTrace?: boolean;
            outputDir?: string;
            generateFix?: boolean;
            sendEmail?: boolean;
            smtpUser?: string;
            smtpPass?: string;
            pushToTelemetry?: boolean;
            browserName?: string;
            headless?: boolean;
            createBug?: boolean;
            githubToken?: string;
            adoToken?: string;
        } = {},
    ) {
        this.testRunName = options.testRunName || 'Playwright Test Run';
        this.outputDir = options.outputDir ?? './test-results';

        this.slowTestThreshold = options.slowTestThreshold ?? 5;
        this.maxSlowTestsToShow = options.maxSlowTestsToShow ?? 3;
        this.timeoutWarningThreshold = options.timeoutWarningThreshold ?? 30;
        this.showStackTrace = options.showStackTrace ?? true;
        this.generateFix = options.generateFix ?? false;
        this.sendEmail = options.sendEmail || false;
        this.smtpUser = options.smtpUser || process.env.SMTP_USER;
        this.smtpPass = options.smtpPass || process.env.SMTP_PASS;

        this.pushToTelemetry = options.pushToTelemetry || false;
        this.browserName = options.browserName ?? 'unknown';
        this.headless = options.headless || false;

        this.createBug = options.createBug || false;
        this.githubToken = options.githubToken || process.env.GITHUB_TOKEN;
        this.adoToken = options.adoToken || process.env.ADO_TOKEN;

        // Ensure the output directory exists

        this.fileHandler = new FileHandler(this.outputDir);
    }

    private monotonicTime(): number {
        const [seconds, nanoseconds] = process.hrtime();
        return seconds * 1000 + ((nanoseconds / 1000000) | 0);
    }

    /**
     * Called when the test run begins.
     * Initializes the start time and displays a start message.
     *
     * @param config - The full Playwright configuration
     * @param suite - The root test suite
     */
    public onBegin(config: FullConfig, suite: Suite): void {
        this.suite = suite;
        this.startTime = this.monotonicTime();
        const totalTestCount = this.countTests(suite);
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);
        console.log(
            `${colors.fgMagentaBright}🚀 Starting test run: ${totalTestCount} tests using ${config.workers} workers${colors.reset}`,
        );
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);
        console.log(`${colors.fgCyan}Test run started at: ${new Date().toLocaleString()}${colors.reset}`);

        // Get project name(s) from configuration
        const projectNames =
            config.projects
                ?.map((project) => project.name)
                .filter(Boolean)
                .join(', ') || 'Default Project';

        console.log(`
            Playwright Test Configuration:
            ------------------------------------

            Test Run Name: ${this.testRunName}
            Project Names: ${projectNames}
            Browser: ${this.browserName}
            Headless: ${this.headless}
            Operating System: ${os.platform()} ${os.release()}

            Generate AI Fix: ${this.generateFix}
            Send Email: ${this.sendEmail}
       
            Slow Test Threshold: ${this.slowTestThreshold} seconds
            Max Slow Tests to Show: ${this.maxSlowTestsToShow}
            Timeout Warning Threshold: ${this.timeoutWarningThreshold} seconds
            Show Stack Trace: ${this.showStackTrace}
           
            Output Directory: ${this.outputDir}
            Workers: ${config.workers}
        `);
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);
        console.log('\n');

        // Use the output directory from reporter config
        // The outputDir is already set in the constructor, so we don't need to reset it here
        // unless there's a specific override in the config

        // If a project-specific output directory is set, use that instead
        if (config.projects && config.projects.length > 0) {
            // Try to find an output directory in any project config
            for (const project of config.projects) {
                if (project.outputDir) {
                    this.outputDir = path.resolve(project.outputDir);
                    this.fileHandler = new FileHandler(this.outputDir);
                    break;
                }
            }
        }
    }

    /**
     * Recursively counts the total number of tests in a suite and its children
     *
     * @param suite - The test suite to count tests from
     * @returns The total number of tests
     * @private
     */
    private countTests(suite: Suite): number {
        let count = suite.tests.length;
        for (const childSuite of suite.suites) {
            count += this.countTests(childSuite);
        }
        return count;
    }

    /**
     * Called when an error occurs during test setup or teardown.
     * Logs the error with optional stack trace based on configuration.
     * Now tracks errors to ensure they affect final exit code.
     *
     * @param error - The error that occurred
     */
    public onError(error: Error): void {
        console.error(`${colors.fgRed}❌ Setup or runtime error: ${error.message}${colors.reset}`);
        if (error.stack && this.showStackTrace) {
            console.error(`${colors.fgRed}${error.stack}${colors.reset}`);
        }

        // Track non-test errors to include in final reporting
        this.nonTestErrors.push(error);
    }

    /**
     * Called when a test completes (whether passed, failed, or skipped).
     * Records the test result and logs appropriate output based on the test status.
     * Now tracks all test statuses including interrupted ones.
     *
     * @param test - The test case that completed
     * @param result - The result of the test execution
     */
    public onTestEnd(test: TestCase, result: TestResult): void {
        const title = test.title;
        const timeTakenSec = result.duration / 1000;

        // Initialize test record if first attempt
        if (!this.testRecords.has(title)) {
            // Create an enhanced test case with required properties
            const testCaseDetails: TestCaseDetails = {
                testId: test.id,
                testTitle: test.title,
                suiteTitle: test.parent?.title || 'Unknown Suite',
                testFile: test.location?.file,
                location: test.location,
                outcome: test.outcome(),
                status: TestUtils.outcomeToStatus(test.outcome()),
                owningTeam: getOwningTeam(test),
            };

            this.testRecords.set(title, {
                test: testCaseDetails,
                attempts: [],
            });
        }

        // Update test record with new attempt
        const testRecord = this.testRecords.get(title);
        if (testRecord) {
            // Fix: Added null check instead of non-null assertion
            testRecord.attempts.push({
                status: result.status,
                duration: timeTakenSec,
                errors: result.errors.map((e) => ({
                    message: e.message || 'No error message',
                    stack: e.stack,
                })),
            });
        }

        // Add failures to the FileHandler
        if (result.status === 'failed' || result.status === 'timedOut') {
            const errorMessage = result.errors[0]?.message || 'Unknown error';
            const errorCategory = TestUtils.categorizeError(errorMessage);

            this.fileHandler.addFailure({
                testId: test.id,
                testTitle: test.title,
                suiteTitle: test.parent?.title || 'Unknown Suite',
                errorMessage: errorMessage,
                errorStack: result.errors[0]?.stack || '',
                duration: timeTakenSec,
                owningTeam: getOwningTeam(test),
                isTimeout: result.status === 'timedOut',
                errorCategory,
                testFile: test.location?.file,
                location: test.location,
            });
        }

        // Track interrupted tests specifically
        if (result.status === 'interrupted') {
            this.hasInterruptedTests = true;
        }

        // Track pass streaks and failures for bug management
        const testKey = test.id || test.title;
        if (result.status === 'passed') {
            const streak = (this.passStreaks.get(testKey) || 0) + 1;
            this.passStreaks.set(testKey, streak);
        } else {
            this.passStreaks.set(testKey, 0);
        }

        if (result.status === 'failed' || result.status === 'timedOut') {
            this.failedTests.push({test, result});
        }

        // Add bug creation logic for failed tests
        if (this.createBug && (result.status === 'failed' || result.status === 'timedOut')) {
            const errorDetails = result.errors?.map((e) => e.message).join('\n') || 'No error details';
            const title = `[Automated Bug] Test failed: ${test.title}`;
            const body = `Test: ${test.title}\n\nError:\n${errorDetails}\n\nPath: ${test.location?.file}:${test.location?.line}`;

            if (process.env.TF_BUILD && this.adoToken) {
                // Azure DevOps - use updated adoUtils functions
                const workItemDetails: WorkItemDetails = {
                    title,
                    description: body,
                    type: WorkItemType.Bug,
                    areaPath: process.env.SYSTEM_TEAMPROJECT || 'DefaultTeam',
                    iterationPath: process.env.SYSTEM_TEAMPROJECT || 'DefaultTeam',
                    reproSteps: errorDetails,
                    tags: ['playwright-test-report', 'automated'],
                };

                createWorkItem(workItemDetails).catch((err) => {
                    console.error(`Failed to create work item: ${err.message}`);
                });
            } else if (process.env.GITHUB_ACTIONS && this.githubToken) {
                // GitHub
                const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
                if (owner && repo) {
                    const ghDetails: GithubBugDetails = {
                        owner,
                        repo,
                        title,
                        body,
                    };
                    const ghCtx: GithubContext = {githubToken: this.githubToken};
                    createGithubBug(ghDetails, ghCtx).catch(() => {});
                }
            }
        }

        // Log test outcome with appropriate formatting
        this.logTestOutcome(test.title, result, timeTakenSec);
    }

    /**
     * Called when all tests have completed.
     * Processes results, displays summary statistics, and sets appropriate exit code.
     * Now properly handles all error conditions including non-test errors.
     */
    public async onEnd(result: FullResult): Promise<void> {
        console.log('\n');
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);
        console.log(`${colors.fgYellow}Finished the test run: ${result.status.toUpperCase()}${colors.reset}`);
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);

        console.log(`${colors.fgCyan}Test run finished at: ${new Date().toLocaleString()}${colors.reset}`);
        this.endTime = this.monotonicTime();
        const totalTimeSec = (this.endTime - this.startTime) / 1000;
        const totalTimeDisplay = TestUtils.formatTime(totalTimeSec);

        // Process results
        const {passedCount, testCount, skippedCount, failures, passedDurations} = TestUtils.processTestResults(
            this.testRecords,
        );

        // Handle no tests case
        if (testCount === 0) {
            console.log(`${colors.fgRed}❌ No tests found${colors.reset}`);
            this.exitWithError();
            return;
        }

        // Gather build information
        const buildInfo = BuildInfoUtils.getBuildInfo();

        // Compute metrics
        const summary: TestSummary = {
            testRunName: this.testRunName,
            testRunStartTime: this.startTime,
            testRunEndTime: this.endTime,
            totalDuration: totalTimeSec,
            browserName: this.browserName,
            headless: this.headless,
            os: os.platform() + ' ' + os.release(),
            failures,
            testCount,
            passedCount,
            skippedCount,
            passRate: parseFloat(((passedCount / testCount) * 100).toFixed(2)),
            status: result.status,
            failedCount: testCount - passedCount - skippedCount,
            totalTimeDisplay,
            averageTime: TestUtils.calculateAverageTime(passedDurations),
            slowestTest: Math.max(...passedDurations, 0),
            slowestTests: TestUtils.findSlowestTests(this.testRecords, this.maxSlowTestsToShow),
            buildInfo,
        };

        // Generate fix suggestions if enabled
        if (this.generateFix && failures.length > 0) {
            await this.generateFixSuggestions(failures);
        }

        // Log results
        Logger.logSummary(summary);

        // Report non-test errors
        if (this.nonTestErrors.length > 0) {
            console.log(`${colors.fgRed}\nSetup or Teardown Errors:${colors.reset}`);
            this.nonTestErrors.forEach((error, index) => {
                console.log(`${colors.fgRed}Error #${index + 1}: ${error.message}${colors.reset}`);
                if (error.stack && this.showStackTrace) {
                    console.log(`${colors.fgRed}${error.stack}${colors.reset}`);
                }
            });
        }

        // Report test failures
        if (failures.length > 0) {
            Logger.logFailures(failures);
        }

        // Extract all test case details for summary
        const allTestCases: TestCaseDetails[] = Array.from(this.testRecords.values()).map((record) => record.test);

        // Write summary and test details to JSON
        this.fileHandler.writeSummary(summary, allTestCases);

        // Record last run status in a separate file
        this.saveLastRunStatus(failures.length > 0);

        // Push to telemetry if enabled
        if (this.pushToTelemetry) {
            try {
                await pushToTelemetry(summary, allTestCases);
                console.log('✅ Telemetry data pushed successfully.');
            } catch (err) {
                console.error('❌ Failed to push telemetry data:', err);
            }
        }

        // Bug creation for each failed test
        await this.handleBugCreationForFailedTests();

        // Auto-resolve bugs if test passed 3 times consecutively after failing
        for (const [testKey, streak] of this.passStreaks.entries()) {
            if (streak >= 3) {
                // Find the test case that corresponds to this key
                const testCase = [...this.testRecords.values()].find(
                    (record) => record.test.testId === testKey || record.test.testTitle === testKey,
                );

                if (testCase) {
                    if (process.env.TF_BUILD) {
                        // Use updated closeWorkItem function
                        await closeWorkItem(testCase.test.testTitle, summary.buildInfo?.buildLink || 'unknown').catch(
                            (err) => {
                                console.error(`Failed to close work item: ${err.message}`);
                            },
                        );
                    } else if (process.env.GITHUB_ACTIONS && this.githubToken && this.bugUrls.has(testKey)) {
                        // Keep existing GitHub implementation
                        const bugUrl = this.bugUrls.get(testKey)!;
                        const ghCtx: GithubContext = {githubToken: this.githubToken};
                        await resolveGithubBug(bugUrl, ghCtx).catch(() => {});
                        this.bugUrls.delete(testKey);
                    }
                }
            }
        }

        // Handle interrupted tests
        if (this.hasInterruptedTests) {
            console.log(
                `${colors.fgRed}\n⚠️ Some tests were interrupted. This may indicate a test hang or timeout.${colors.reset}`,
            );
        }

        // Determine exit status (any errors should cause a non-zero exit)
        const hasErrors = failures.length > 0 || this.nonTestErrors.length > 0 || this.hasInterruptedTests;

        if (hasErrors) {
            this.exitWithError();
        } else {
            this.exitWithSuccess();
        }

        // Example usage after test run (call this in onEnd or where appropriate):
        await this.sendEmailNotificationToAll(
            'Playwright Test Run Results',
            'test-summary', // handlebars template name (test-summary.handlebars)
            {summary: summary},
        );
    }

    /**
     * Exits the process with a success code.
     * Extracted to a method to make the flow clearer and more maintainable.
     * @private
     */
    private exitWithSuccess(): void {
        process.exitCode = 0;
    }

    /**
     * Exits the process with an error code.
     * Extracted to a method to make the flow clearer and more maintainable.
     * @private
     */
    private exitWithError(): void {
        process.exitCode = 1;
    }

    /**
     * Formats and logs the outcome of a single test with appropriate coloring.
     * Handles different test states (passed, failed, skipped) and retry attempts.
     * Now includes handling for interrupted tests and other unexpected statuses.
     *
     * @param title - The title of the test
     * @param result - The result of the test execution
     * @param timeTakenSec - The time taken by the test in seconds
     * @private
     */
    private logTestOutcome(title: string, result: TestResult, timeTakenSec: number): void {
        const timeTakenFormatted = timeTakenSec.toFixed(2);
        let passMessage: string;

        switch (result.status) {
            case 'passed':
                passMessage = result.retry > 0 ? `✅ ${title} passed after retry` : `✅ ${title}`;
                console.log(`${colors.fgGreen}${passMessage} in ${timeTakenFormatted}s${colors.reset}`);
                break;

            case 'failed':
            case 'timedOut':
                if (result.retry > 0) {
                    console.log(
                        `${colors.fgYellow}🔄 Retry attempt #${result.retry + 1} for "${title}"${colors.reset}`,
                    );
                } else {
                    console.log(`${colors.fgRed}❌ ${title} failed in ${timeTakenFormatted}s${colors.reset}`);
                }
                break;

            case 'skipped':
                console.log(`${colors.fgGray}⚠️ ${title} was skipped${colors.reset}`);
                break;

            case 'interrupted':
                console.log(`${colors.fgRed}🛑 ${title} was interrupted${colors.reset}`);
                break;

            default:
                console.log(
                    `${colors.fgRed}⚠️ ${title} ended with unknown status: ${result.status} in ${timeTakenFormatted}s${colors.reset}`,
                );
                break;
        }
    }

    /**
     * Records the status of the last test run in a JSON file
     * @param hasFailed - Whether any tests failed
     */
    private saveLastRunStatus(hasFailed: boolean): void {
        const failedTests = Array.from(this.testRecords.values())
            .filter((record) => record.test.status === 'failed')
            .map((record) => record.test.testId || '');

        const lastRunData = {
            status: hasFailed ? 'failed' : 'passed',
            failedTests,
        };

        try {
            const filePath = path.join(this.outputDir, '.last-run.json');
            fs.writeFileSync(filePath, JSON.stringify(lastRunData, null, 2));
        } catch (error) {
            console.error('Failed to write last run status:', error);
        }
    }

    /**
     * Generates AI-powered fix suggestions for test failures
     *
     * @param failures - Array of test failures
     * @private
     */
    private async generateFixSuggestions(failures: TestFailure[]): Promise<void> {
        console.log('\n');
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);
        console.log(`${colors.fgCyan}🤖 Generating AI-powered fix suggestions...${colors.reset}`);
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);
        const sourceCodeCache = new Map<string, string>();

        for (const failure of failures) {
            if (!failure.testFile) continue;

            try {
                console.log(`${colors.fgYellow}Generating fix suggestion for: ${failure.testTitle}${colors.reset}`);

                // Read the source file
                if (!sourceCodeCache.has(failure.testFile)) {
                    const source = fs.readFileSync(failure.testFile, 'utf8');
                    sourceCodeCache.set(failure.testFile, source);
                }

                const result = await GenAIUtils.generateFixSuggestion(failure, sourceCodeCache);

                if (result) {
                    console.log(`${colors.fgGreen}✅ Fix suggestion generated:${colors.reset}`);
                    console.log(`${colors.fgGreen}  - Prompt: ${result.promptPath}${colors.reset}`);
                    console.log(`${colors.fgGreen}  - Fix: ${result.fixPath}${colors.reset}`);
                } else {
                    console.warn(`${colors.fgYellow}⚠️ Could not generate fix suggestion.${colors.reset}`);
                    console.warn(
                        `${colors.fgYellow}   Check if you have a .env file with MISTRAL_API_KEY in the project root.${colors.reset}`,
                    );
                }
            } catch (error) {
                console.error(
                    `${colors.fgRed}❌ Error generating fix suggestion for ${failure.testTitle}: ${error}${colors.reset}`,
                );
            }
        }

        console.log(`${colors.fgCyan}AI fix suggestion generation complete${colors.reset}`);

        console.log(`${colors.fgCyan}Thank you for using the AI fix suggestion tool!${colors.reset}`);
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);
    }

    /**
     * Create or update bugs for all failed test cases after the run.
     * Adds colorized logging for each bug operation.
     * Uses team email for each failing test.
     */
    private async handleBugCreationForFailedTests() {
        if (!this.createBug || this.failedTests.length === 0) return;

        console.log(`${colors.fgCyan}===============================================${colors.reset}`);
        console.log(`${colors.fgMagentaBright}🐞 Creating/updating bugs for failed test cases...${colors.reset}`);
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);

        for (const {test, result} of this.failedTests) {
            const errorDetails = result.errors?.map((e) => e.message).join('\n') || 'No error details';
            const bugTitle = `[Automated Bug] Test failed: ${test.title}`;
            const bugBody = `Test: ${test.title}\n\nError:\n${errorDetails}\n\nPath: ${test.location?.file}:${test.location?.line}`;
            const testKey = test.id || test.title;

            // Get team info for this test
            const teamInfo = this.getTestTeamInfo(test);
            const teamEmails = teamInfo?.email || [];

            if (process.env.TF_BUILD) {
                try {
                    const workItemDetails: WorkItemDetails = {
                        title: bugTitle,
                        description: bugBody + (teamEmails.length ? `\n\nTeam Emails: ${teamEmails.join(', ')}` : ''),
                        type: WorkItemType.Bug,
                        areaPath: process.env.SYSTEM_TEAMPROJECT || 'DefaultTeam',
                        iterationPath: process.env.SYSTEM_TEAMPROJECT || 'DefaultTeam',
                        reproSteps: errorDetails,
                        tags: ['playwright-test-report', 'automated'],
                    };

                    const success = await createWorkItem(workItemDetails);
                    if (success) {
                        console.log(
                            `${colors.fgYellow}⚠️ Azure DevOps bug created/updated for: ${bugTitle}${colors.reset}`,
                        );
                    }
                } catch (err) {
                    console.log(`${colors.fgRed}❌ Failed to create/update Azure DevOps bug: ${err}${colors.reset}`);
                }
            } else if (process.env.GITHUB_ACTIONS && this.githubToken) {
                // Keep existing GitHub implementation
                const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
                if (owner && repo) {
                    const ghDetails: GithubBugDetails = {
                        owner,
                        repo,
                        title: bugTitle,
                        body: bugBody + (teamEmails.length ? `\n\nTeam Emails: ${teamEmails.join(', ')}` : ''),
                    };
                    const ghCtx: GithubContext = {githubToken: this.githubToken};
                    try {
                        const url = await createGithubBug(ghDetails, ghCtx);
                        if (url) {
                            this.bugUrls.set(testKey, url);
                            console.log(`${colors.fgYellow}⚠️ GitHub issue created: ${url}${colors.reset}`);
                        }
                    } catch (err) {
                        console.log(`${colors.fgRed}❌ Failed to create GitHub issue: ${err}${colors.reset}`);
                    }
                }
            }

            // Optionally: send email to team for each failing test (if desired)
            // You can implement per-test email notification here using teamEmails
        }
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);
    }

    /**
     * Helper to extract team name from test annotations.
     */
    private extractTeamName(test: TestCase): string | undefined {
        // Playwright test.annotations is an array of {type, description}
        const annotation = (test as any).annotations?.find((a: any) => a.type === 'team');
        if (annotation) {
            try {
                // Try to parse JSON description, fallback to string
                if (typeof annotation.description === 'string') {
                    const parsed = JSON.parse(annotation.description);
                    if (parsed && parsed.teamName) return parsed.teamName;
                    // fallback: if not JSON, treat as plain string
                    return annotation.description;
                }
                if (annotation.description && annotation.description.teamName) {
                    return annotation.description.teamName;
                }
            } catch {
                return annotation.description;
            }
        }
        return undefined;
    }

    /**
     * Helper to get team info for a test.
     */
    private getTestTeamInfo(test: TestCase): ITeamInfo | undefined {
        const teamName = this.extractTeamName(test);
        if (teamName) {
            return getTeamInfo(teamName);
        }
        return undefined;
    }

    /**
     * Sends an email notification using a Handlebars template.
     * @param subject - Email subject
     * @param templateName - Name of the handlebars template file (without extension)
     * @param templateData - Data to inject into the template
     */
    private async sendEmailNotificationToAll(subject: string, templateName: string, templateData: any) {
        if (!this.sendEmail || !this.attributes?.emails || this.attributes.emails.length === 0) return;

        console.log('\n');
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);
        console.log(`${colors.fgCyan}Preparing to send test run email notification...${colors.reset}`);
        console.log(`${colors.fgCyan}Email Subject: ${subject}${colors.reset}`);
        console.log(`${colors.fgCyan}Recipients: ${this.attributes.emails.join(', ')}${colors.reset}`);
        console.log(`${colors.fgCyan}===============================================${colors.reset}`);

        // Load and compile the Handlebars template
        const templatePath = path.join(__dirname, '..', 'handlebars', `${templateName}.handlebars`);
        const templateSource = fs.readFileSync(templatePath, 'utf8');
        const template = Handlebars.compile(templateSource);

        const htmlBody = template(templateData);

        const transporter = NodeMailer.createTransport({
            host: 'smtp.office365.com',
            port: 587,
            secure: false,
            auth: {
                user: this.smtpUser,
                pass: this.smtpPass,
            },
        });

        try {
            await transporter.sendMail({
                from: this.smtpUser,
                to: this.attributes.emails.join(','),
                subject: subject,
                html: htmlBody,
            });
            console.log(
                `${colors.fgGreen}✅ Email sent successfully to: ${this.attributes.emails.join(', ')}${colors.reset}`,
            );
        } catch (err) {
            console.log(`${colors.fgRed}❌ Failed to send email: ${err}${colors.reset}`);
        }
    }
}
