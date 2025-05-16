import * as fs from 'fs';
import * as path from 'path';
import {TestCase} from '@playwright/test/reporter';

export interface ITeamInfo {
    email: string[];
    areaPath?: string;
}

// Load teams.json from the src folder
const teamsFilePath = path.resolve(__dirname, '../teams.json');
let teamData: Record<string, ITeamInfo> = {};

function loadTeams() {
    if (fs.existsSync(teamsFilePath)) {
        const raw = fs.readFileSync(teamsFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        teamData = parsed;
    }
}
loadTeams();

export function getTeamInfo(teamName: string): ITeamInfo | undefined {
    if (!teamName) return undefined;
    // Try direct match first
    if (teamData[teamName]) return teamData[teamName];
    // Case-insensitive match
    const foundKey = Object.keys(teamData).find((key) => key.toLowerCase() === teamName.toLowerCase());
    return foundKey ? teamData[foundKey] : undefined;
}

export function getAllTeams(): Record<string, ITeamInfo> {
    return teamData;
}

/**
 * Returns all team names from teams.json
 */
export function getAllTeamNames(): string[] {
    return Object.keys(teamData);
}

// Helper to create annotation from team name
export function getTeamAnnotation(teamName: string) {
    const team = getTeamInfo(teamName);
    return {
        type: 'team',
        description: JSON.stringify({
            teamName,
            emails: team?.email || [],
            areaPath: team?.areaPath || '',
        }),
    };
}

/**
 * Returns all unique emails from all teams in teams.json
 */
export function getAllTeamEmails(): string[] {
    const emails = new Set<string>();
    Object.values(teamData).forEach((team) => {
        (team.email || []).forEach((e) => emails.add(e));
    });
    return Array.from(emails);
}

/**
 * Determines the team that owns a test based on test name and annotations.
 * Looks for a "team" annotation and parses its description as JSON to get the teamName,
 * then checks if that teamName exists in teams.json. Falls back to owner annotation,
 * then to process.env.FALLBACK_TEAM or fallbackTeam from teams.json.
 * @param test - Test case to analyze
 * @returns Name of the team that owns the test
 */
export function getOwningTeam(test: TestCase): string {
    // Try to get team name from annotation (parse JSON if needed)
    const teamAnnotation = (test as any).annotations?.find((a: any) => a.type === 'team');
    if (teamAnnotation) {
        try {
            if (typeof teamAnnotation.description === 'string') {
                // Try to parse as JSON
                const parsed = JSON.parse(teamAnnotation.description);
                if (parsed && parsed.teamName && parsed.teamName in teamData) {
                    return parsed.teamName;
                }
                // fallback: if not JSON, treat as plain string
                if (teamAnnotation.description in teamData) {
                    return teamAnnotation.description;
                }
            } else if (teamAnnotation.description && teamAnnotation.description.teamName) {
                if (teamAnnotation.description.teamName in teamData) {
                    return teamAnnotation.description.teamName;
                }
            }
        } catch {
            // If parsing fails, treat as plain string
            if (typeof teamAnnotation.description === 'string' && teamAnnotation.description in teamData) {
                return teamAnnotation.description;
            }
        }
    }

    return 'Unknown'; // Fallback to 'Unknown' if no team is found
}
