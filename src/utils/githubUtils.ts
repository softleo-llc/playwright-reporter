export interface GithubBugDetails {
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels?: string[];
    assignees?: string[];
}

export interface GithubContext {
    githubToken: string;
    issueUrl?: string;
    reason?: string;
    isCreatingNewBug?: boolean;
}

// Use dynamic import for Octokit
async function getOctokit(token: string) {
    const {Octokit} = await import('@octokit/rest');
    return new Octokit({auth: token});
}

export async function createGithubBug(details: GithubBugDetails, ctx: GithubContext): Promise<string | undefined> {
    const octokit = await getOctokit(ctx.githubToken);

    try {
        const result = await octokit.issues.create({
            owner: details.owner,
            repo: details.repo,
            title: details.title,
            body: details.body,
            labels: details.labels || ['bug', 'automation'],
            assignees: details.assignees || [],
        });
        ctx.issueUrl = result.data.html_url;
        ctx.isCreatingNewBug = true;
        ctx.reason = `Created GitHub issue: ${result.data.html_url}`;
        return result.data.html_url;
    } catch (error: any) {
        ctx.isCreatingNewBug = false;
        ctx.reason = `Failed to create GitHub issue: ${error.message || error}`;
        throw new Error(ctx.reason);
    }
}

export async function resolveGithubBug(issueUrl: string, ctx: GithubContext): Promise<void> {
    // issueUrl: https://github.com/{owner}/{repo}/issues/{number}
    const match = issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!match) throw new Error('Invalid GitHub issue URL');
    const [, owner, repo, number] = match;
    const octokit = await getOctokit(ctx.githubToken);

    await octokit.issues.update({
        owner,
        repo,
        issue_number: Number(number),
        state: 'closed',
    });
}
