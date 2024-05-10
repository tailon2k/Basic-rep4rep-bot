import SteamUser from 'steam-user';
import SteamCommunity from 'steamcommunity';
import { readFileSync, writeFileSync } from 'fs';
import api from './api.js';
import { config } from './config.js';

const user = new SteamUser({ renewRefreshTokens: true });
const community = new SteamCommunity();
let logOnOptions = {};

try {
    const refreshToken = readFileSync('refresh_token.txt', 'utf8').trim();
    logOnOptions = { refreshToken };
} catch (ex) {
    console.log('No refresh token saved. Logging on with account name and password.');
    logOnOptions = {
        accountName: config.username,
        password: config.password
    };
}

user.logOn(logOnOptions);

user.on('loggedOn', function () {
    console.log(`Logged on to Steam as ${this.steamID}`);
    user.setPersona(7);
});

user.on('webSession', async function (sessionID, cookies) {
    community.setCookies(cookies);
    console.log('Got web session');
    await autoComment(this.steamID.getSteamID64());
});

user.on('refreshToken', function (token) {
    console.log('Got new refresh token');
    writeFileSync('refresh_token.txt', token);
});

async function autoComment(steamID) {
    try {
        console.log(`Starting auto comment process...`);

        let repSteamProfiles = [];
        let repSteamProfilesObj = {};

        console.log('Fetching steam profiles from rep4rep...');
        const steamProfiles = await api.getSteamProfiles();
        steamProfiles.forEach((steamProfile) => {
            repSteamProfiles.push(steamProfile.steamId);
            repSteamProfilesObj[steamProfile.steamId] = steamProfile.id;
        });

        if (!repSteamProfiles.includes(steamID)) {
            console.log('Account not added on rep4rep! Adding now...');
            await api.addSteamProfile(steamID);

            console.log('Fetching steam profiles after adding the profile...');
            const updatedSteamProfiles = await api.getSteamProfiles();
            updatedSteamProfiles.forEach((steamProfile) => {
                repSteamProfiles.push(steamProfile.steamId);
                repSteamProfilesObj[steamProfile.steamId] = steamProfile.id;
            });
        }

        console.log('Fetching tasks...');
        const tasks = await api.getTasks(repSteamProfilesObj[steamID]);
        let failedAttempts = 0;

        for (const task of tasks) {
            if (failedAttempts === 2) {
                console.log('Failed twice, the account is rate-limited for today.');
                break;
            }

            console.log(`Posting comment on profile: https://steamcommunity.com/profiles/${task.targetSteamProfileId}\nComment: ${task.requiredCommentText}`);

            community.postUserComment(task.targetSteamProfileId, task.requiredCommentText, async (err) => {
                if (err) {
                    console.log(`Failed to post comment on profile: ${task.targetSteamProfileId}`);
                    console.log(err.message);
                    failedAttempts++;
                } else {
                    console.log('Comment posted successfully!');
                    await api.completeTask(task.taskId, task.requiredCommentId, repSteamProfilesObj[steamID]);
                    console.log('The comment will be verified shortly...');
                }
            });

            await sleep(10000);
        }

        console.log('Auto comment process completed.');
        process.exit(0);

    } catch (error) {
        console.error(`Error in auto comment function for SteamID: ${steamID}:`, error.message);
    }
}

function sleep(millis) {
    return new Promise(resolve => setTimeout(resolve, millis));
}

user.on('error', function(e) {
    console.log(e);
});