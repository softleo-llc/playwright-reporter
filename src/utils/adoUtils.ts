/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 */

import {getPersonalAccessTokenHandler, WebApi} from 'azure-devops-node-api';
import {IRequestOptions} from 'azure-devops-node-api/interfaces/common/VsoBaseInterfaces';
import {JsonPatchOperation, Operation} from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import {TelemetryDb} from '../db/telemetryDb';

// Create a telemetry database instance for logging operations
const telemetryDb = new TelemetryDb();
telemetryDb.initializeTables();

// Tag used to identify bugs created by the reporter
const REPORTER_TAG = 'playwright-test-report';

export interface AdoProjectInfo {
    id: string;
    name: string;
    orgUrl: string;
}

export enum WorkItemType {
    Bug = 'Bug',
    Task = 'Task',
}

export interface WorkItemDetails {
    title: string;
    type: WorkItemType;
    areaPath: string;
    iterationPath: string;
    description: string;
    reproSteps?: string;
    tags?: string[];
    extraFields?: Map<string, string>;
}

export function getAdoOrgInfo(): {org: string; url: string} {
    const org = process.env.AZURE_DEVOPS_ORG || '';
    const url =
        process.env.AZURE_DEVOPS_COLLECTION_URL ||
        process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI ||
        (org ? `https://dev.azure.com/${org}/` : '');
    return {org, url};
}

export function getProjectInfo(): AdoProjectInfo {
    const {org, url} = getAdoOrgInfo();
    const projectId = process.env.SYSTEM_TEAMPROJECTID || '';
    const projectName = process.env.SYSTEM_TEAMPROJECT || '';

    if (!url) {
        console.error(`##[error] Project collection URI is not provided.`);
    }
    if (!projectId) {
        console.error(`##[error] Project ID is not provided.`);
    }
    if (!projectName) {
        console.error(`##[error] Project name is not provided.`);
    }
    return {
        id: projectId,
        name: projectName,
        orgUrl: url,
    };
}

export async function getWebApi(): Promise<WebApi | null> {
    const projectInfo = getProjectInfo();
    const orgToken = process.env.SYSTEM_ACCESSTOKEN;

    if (!orgToken) {
        const message = `##[error] Access token is not provided. SYSTEM_ACCESSTOKEN is missing.`;
        console.error(message);
        await logToTelemetry('GetWebApi', 'error', message);
        return null;
    }

    try {
        const ado: WebApi = new WebApi(projectInfo.orgUrl, getPersonalAccessTokenHandler(orgToken));
        const connected = await ado.connect();
        const status = connected ? 'Connected Successfully!!' : 'Failed to Connect!';
        console.log(status);
        await logToTelemetry('GetWebApi', connected ? 'success' : 'error', status);
        return ado;
    } catch (err) {
        console.error(err);
        await logToTelemetry('GetWebApi', 'error', (err as Error).message);
        return null;
    }
}

export async function getWebApiUsingToken(orgUrl: string, orgToken: string): Promise<WebApi | null> {
    if (!orgToken) {
        const message = 'Invalid or empty org token';
        console.log(message);
        await logToTelemetry('GetWebApiUsingToken', 'error', message);
        return null;
    }
    try {
        const authHandler = getPersonalAccessTokenHandler(orgToken);
        const options: IRequestOptions = {
            allowRetries: true,
            maxRetries: 3,
        };
        const vsts: WebApi = new WebApi(orgUrl, authHandler, options);
        await vsts.connect();
        await logToTelemetry('GetWebApiUsingToken', 'success', 'Connected using token');
        return vsts;
    } catch (e) {
        const errorMsg = (e as Error).toString();
        console.error(errorMsg);
        await logToTelemetry('GetWebApiUsingToken', 'error', errorMsg);
        return null;
    }
}

export async function getWorkItemIds(title: string): Promise<number[]> {
    // escape single quotes and double quotes
    title = title.replace(/"/g, '"').replace(/'/g, "''");

    const query = `
        SELECT [System.Id]
        FROM workitems
        WHERE [System.TeamProject] = @project AND
        [System.Tags] Contains '${REPORTER_TAG}' AND
        [System.State] <> 'Closed' AND
        [System.State] <> 'Done' AND
        [System.State] <> 'Resolved' AND
        [System.State] <> 'Removed' AND
        [System.Title] = '${title}'
        `;
    try {
        const items = await queryByWiql(query);
        console.log(`##[section]Query: ${query}, \tItems found: ${items.length}`);
        await logToTelemetry('GetWorkItemIds', 'info', `Found ${items.length} work items`, {title});
        return items.length > 0 ? items : [];
    } catch (err) {
        const errorMsg = `Error checking for work item: "${title}", err: ${err ?? ''}`;
        console.log(`##[error]: ${errorMsg}`);
        console.log('##[section]Query: ', query);
        await logToTelemetry('GetWorkItemIds', 'error', errorMsg);
        return [];
    }
}

async function queryByWiql(query: string): Promise<number[]> {
    const webApi = await getWebApi();
    const workItemsApi = await webApi?.getWorkItemTrackingApi();
    const projectName = process.env.SYSTEM_TEAMPROJECT || '';

    const result = await workItemsApi?.queryByWiql(
        {query},
        {
            project: projectName,
        },
    );

    if (!result || !result.workItems) {
        return [];
    }
    const ids: number[] = [];
    result.workItems.forEach((item) => {
        if (item && item.id) {
            ids.push(item.id);
        }
    });
    console.log('Work Items IDs: ', ids);
    return ids;
}

export async function createWorkItem(details: WorkItemDetails): Promise<boolean> {
    console.log('Checking for any existing work item.');
    const teamProjectName = process.env.SYSTEM_TEAMPROJECT || '';
    const workItemIds: number[] = await getWorkItemIds(details.title);

    const ctx: Record<string, string | number | boolean> = {
        title: details.title,
        areaPath: details.areaPath,
        iterationPath: details.iterationPath,
    };

    if (workItemIds.length > 0) {
        console.log(
            `Work item already exists!! Not creating new Bugs. Updating the history of the bug: ${details.title}`,
        );
        await logToTelemetry('CreateWorkItem', 'info', 'Work item already exists, updating history', ctx);

        for (const workItemId of workItemIds) {
            try {
                const webApi = await getWebApi();
                const workItemsApi = await webApi?.getWorkItemTrackingApi();
                const operations: JsonPatchOperation[] = [
                    {
                        op: Operation.Add,
                        path: '/fields/System.History',
                        value: details.description,
                    },
                ];
                const workItem = await workItemsApi?.updateWorkItem(null, operations, workItemId, teamProjectName);
                ctx.isCreatingNewBug = false;
                if (workItem) {
                    console.log('##[section]Updated work item: ', workItem?.id);
                    ctx.status = `Updated work item: ${workItem?.id}`;
                    await logToTelemetry('CreateWorkItem', 'success', `Updated work item: ${workItem?.id}`, ctx);
                } else {
                    console.error('##[error]Failed to update work Item');
                    ctx.status = `Failed to update work Item: ${workItemId}`;
                    await logToTelemetry('CreateWorkItem', 'error', `Failed to update work item: ${workItemId}`, ctx);
                }
            } catch (err) {
                const errorMsg = (err as Error).message;
                await logToTelemetry('CreateWorkItem', 'error', errorMsg, ctx);
                console.error(`##[error]: Error updating work item, err: ${err ?? ''}`);
            }
        }
        return true;
    }

    const webApi = await getWebApi();
    const workItemsApi = await webApi?.getWorkItemTrackingApi();

    const operations: JsonPatchOperation[] = [
        {op: Operation.Add, path: '/fields/System.Title', value: details.title},
        {op: Operation.Add, path: '/fields/System.AreaPath', value: details.areaPath},
        {op: Operation.Add, path: '/fields/System.IterationPath', value: details.iterationPath},
        {op: Operation.Add, path: '/fields/System.Description', value: details.description},
        {op: Operation.Add, path: '/fields/System.Tags', value: REPORTER_TAG},

        {
            op: Operation.Add,
            path: '/fields/System.History',
            value: details.description,
        },
    ];

    if (details.tags) {
        operations.push({op: Operation.Add, path: '/fields/System.Tags', value: details.tags.join(';')});
    }
    if (details.extraFields && details.extraFields.size > 0) {
        details.extraFields.forEach((val: any, field: any) => {
            operations.push({op: Operation.Add, path: field, value: val});
        });
    }

    try {
        ctx.isCreatingNewBug = true;
        ctx.reason = `Creating new work item: ${details.title}`;

        await logToTelemetry('CreateWorkItem', 'info', `Attempting to create work item: ${details.title}`, ctx);

        const workItem = await workItemsApi?.createWorkItem(null, operations, teamProjectName, details.type);
        if (workItem) {
            console.log('##[section]Created work item: ', workItem?.id);
            ctx.status = `Created work item: ${workItem?.id}`;
            await logToTelemetry('CreateWorkItem', 'success', `Created work item: ${workItem?.id}`, ctx);
            return true;
        } else {
            console.error('##[error]Failed to create work Item');
            ctx.status = 'Failed to create work Item';
            await logToTelemetry('CreateWorkItem', 'error', 'Failed to create work Item', ctx);
            return false;
        }
    } catch (err) {
        const errorMsg = (err as Error).message;
        await logToTelemetry('CreateWorkItem', 'error', errorMsg, ctx);
        console.error(`##[error]: Error creating work item, err: ${err ?? ''}`);
    }
    return true;
}

export async function closeWorkItem(title: string, buildLink: string): Promise<void> {
    console.log('Checking for work items to close.');
    const teamProjectName = process.env.SYSTEM_TEAMPROJECT || '';
    const workItemIds: number[] = await getWorkItemIds(title);

    const ctx: Record<string, string | number | boolean> = {
        title,
        buildLink,
    };

    if (workItemIds.length > 0) {
        console.log('##[group]Closing the work items');
        await logToTelemetry('CloseWorkItem', 'info', `Found ${workItemIds.length} work items to close`, ctx);

        for (const workItemId of workItemIds) {
            try {
                console.log(`Work item exists, closing the bug: ${workItemId}`);
                ctx.reason = `Closing bug: ${workItemId}`;

                const webApi = await getWebApi();
                const workItemsApi = await webApi?.getWorkItemTrackingApi();
                const operations: JsonPatchOperation[] = [
                    {
                        op: Operation.Add,
                        path: '/fields/System.History',
                        value: `This test is now passing in build ${buildLink}.`,
                    },
                ];

                // Add the operation to close the work item
                operations.push({op: Operation.Add, path: '/fields/System.State', value: 'Closed'});

                const workItem = await workItemsApi?.updateWorkItem(null, operations, workItemId, teamProjectName);

                if (workItem) {
                    console.log('##[section]Closed the work item: ', workItem?.id);
                    ctx.status = `Closed work item: ${workItem?.id}`;
                    await logToTelemetry('CloseWorkItem', 'success', `Closed work item: ${workItem?.id}`, ctx);
                } else {
                    console.error('##[error]Failed to close work Item');
                    ctx.status = `Failed to close work item: ${workItemId}`;
                    await logToTelemetry('CloseWorkItem', 'error', `Failed to close work item: ${workItemId}`, ctx);
                }
            } catch (err) {
                const errorMsg = (err as Error).message;
                await logToTelemetry('CloseWorkItem', 'error', errorMsg, ctx);
                console.error(`##[error]: Error closing work item, err: ${err ?? ''}`);
            }
        }
        console.log('##[endgroup]');
    } else {
        console.log(`No work items found to close for: ${title}`);
        await logToTelemetry('CloseWorkItem', 'info', `No work items found to close for: ${title}`, ctx);
    }
}

// Helper function to log to telemetry
async function logToTelemetry(
    eventName: string,
    eventType: 'info' | 'success' | 'error',
    message?: string,
    properties?: Record<string, any>,
): Promise<void> {
    try {
        await telemetryDb.logAdoOperation({
            eventName,
            eventType,
            message,
            properties,
        });
    } catch (error) {
        console.error('Failed to log to telemetry:', error);
    }
}

// ...additional methods kept for reference but need similar cleanup...
