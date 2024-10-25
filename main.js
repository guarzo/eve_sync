// main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const tar = require('tar'); // For creating backups
const log = require('electron-log'); // Optional: For logging
const os = require('os');
const { exec } = require('child_process');

// Default settings directory
let settingsDir = ''; // This will hold the final settings directory, based on user choice or default.
const settingsFilePath = path.join(app.getPath('userData'), 'settings.json');

const defaultPaths = {
    win32: path.join(os.homedir(), 'AppData', 'Local', 'CCP', 'EVE', 'c_ccp_eve_online_tq_tranquility'),
    darwin: path.join(os.homedir(), 'Library', 'Application Support', 'CCP', 'EVE', 'c_ccp_eve_online_tq_tranquility'),
    linux: path.join(os.homedir(), '.local', 'share', 'CCP', 'EVE', 'c_ccp_eve_online_tq_tranquility'), // Example for native Linux
    wslBase: path.join('AppData', 'Local', 'CCP', 'EVE', 'c_ccp_eve_online_tq_tranquility') // Use this as the base WSL path, combined with Windows home directory
};

const failedESICachePath = path.join(app.getPath('userData'), 'failed_esi_requests.json');
const characterCachePath = path.join(app.getPath('userData'), 'character_cache.json');
const associationsPath = path.join(app.getPath('userData'), 'associations.json');

let failedESICache = {};
let characterCache = {};
let associations = []; // Ensure it's an array

// Initialize a counter for failed HTTP requests
let failedHTTPRequests = 0;

// Load caches and associations
async function loadCachesAndAssociations() {
    try {
        const [failedESIData, characterCacheData, associationsData] = await Promise.all([
            fs.readFile(failedESICachePath, 'utf8').catch(() => '{}'),
            fs.readFile(characterCachePath, 'utf8').catch(() => '{}'),
            fs.readFile(associationsPath, 'utf8').catch(() => '[]') // Default to empty array
        ]);

        failedESICache = JSON.parse(failedESIData);
        characterCache = JSON.parse(characterCacheData);
        associations = JSON.parse(associationsData);

        // Ensure associations is an array
        if (!Array.isArray(associations)) {
            console.warn('Associations data is not an array. Resetting to empty array.');
            associations = [];
            await saveAssociations(associations);
        }
    } catch (error) {
        console.error('Error loading caches and associations:', error);
    }
}

// Save caches and associations
async function saveFailedESICache() {
    try {
        await fs.writeFile(failedESICachePath, JSON.stringify(failedESICache, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving failedESICache:', error);
    }
}

async function saveCharacterCache() {
    try {
        await fs.writeFile(characterCachePath, JSON.stringify(characterCache, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving characterCache:', error);
    }
}

async function saveAssociations(newAssociations) {
    associations = newAssociations;
    try {
        await fs.writeFile(associationsPath, JSON.stringify(associations, null, 2), 'utf8');
        log.info('Associations saved successfully.');
    } catch (error) {
        console.error('Error saving associations:', error);
    }
}

// Helper function to fetch character name from ESI API
async function getCharacterName(charId, fullFilePath) {
    if (failedESICache[fullFilePath]) {
        console.log(`Skipping ESI request for ${fullFilePath} as it previously failed.`);
        return null;
    }

    // Use cached character names if available
    if (characterCache[charId]) {
        return characterCache[charId];
    }

    try {
        const response = await axios.get(`https://esi.evetech.net/latest/characters/${charId}/?datasource=tranquility`);
        const charName = response.data.name;
        characterCache[charId] = charName;  // Cache the name
        await saveCharacterCache();
        return charName;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.warn(`Character ID ${charId} not found (404).`);
        } else {
            console.warn(`Failed to fetch character name for ID ${charId}, file: ${fullFilePath}: ${error.message}`);
        }
        failedESICache[fullFilePath] = true;
        failedHTTPRequests += 1;
        await saveFailedESICache();
        return null;
    }
}

// Create the main Electron window
function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false
        }
    });

    // Disable the menu bar
    win.setMenuBarVisibility(false);

    win.loadFile(path.join(__dirname, 'main.html')).catch(error => {
        console.error('Failed to load main.html:', error);
    });
}

// Function to load mappings
async function loadMappings() {
    await loadCachesAndAssociations();

    let subDirs;
    try {
        subDirs = await fs.readdir(settingsDir);
    } catch (error) {
        console.error(`Error reading settings directory ${settingsDir}:`, error);
        subDirs = [];
    }

    const mappings = [];

    for (const subDir of subDirs) {
        const fullSubDirPath = path.join(settingsDir, subDir);
        let stats;
        try {
            stats = await fs.lstat(fullSubDirPath);
        } catch (error) {
            console.error(`Error getting stats for subdirectory ${fullSubDirPath}:`, error);
            continue;
        }

        if (stats.isDirectory()) {
            const { availableCharFiles, availableUserFiles } = await getFilesForDropdown(subDir);

            mappings.push({
                subDir: subDir.replace('settings_', ''),
                availableCharFiles: Array.isArray(availableCharFiles) ? availableCharFiles : [],
                availableUserFiles: Array.isArray(availableUserFiles) ? availableUserFiles : []
            });
        }
    }

    return {
        mappings,
        associations
    };
}

// Ensure ipcMain handlers are registered only once
function registerIpcHandlers() {

    // Handle loading user selections
    ipcMain.handle('load-user-selections', async () => {
        return await loadUserSelections();
    });

    ipcMain.handle('check-if-default-directory', async (event, dir) => {
        return checkIfDefaultDirectory(dir);
    });

    // Handle loading settings directory
    ipcMain.handle('load-settings-dir', async (event) => {
        const result = await loadSettingsDirectory();
        event.sender.send('update-directory-button', result.settingsDir); // Send result to the renderer process
    });

    // Handle saving user selections
    ipcMain.handle('save-user-selections', async (event, selections) => {
        return await saveUserSelections(selections);
    });

    // Handle navigation between pages
    ipcMain.on('navigate-to', (event, page) => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) {
            const pagePath = path.join(__dirname, page);
            win.loadFile(pagePath).catch(error => {
                console.error(`Failed to navigate to ${page}:`, error);
            });
        } else {
            console.error('No focused window to navigate');
        }
    });

    // Handle choosing settings directory
    ipcMain.handle('choose-settings-dir', async (event) => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            settingsDir = result.filePaths[0];
            console.log(`Settings directory changed to: ${settingsDir}`);

            // Save the selected directory for future sessions
            await saveSettingsDirectory(settingsDir);

            // Instead of manually checking for default and sending the text,
            // send the selected directory path back to the renderer process
            return { success: true, settingsDir };
        } else {
            return { success: false };
        }
    });


    // Handle 'load-settings'
    ipcMain.handle('load-settings', async () => {
        return await loadSettings();
    });

    // Handle 'load-mappings'
    ipcMain.handle('load-mappings', async () => {
        return await loadMappings();
    });

    // Handle IPC for associating characters with users
    ipcMain.handle('associate-character', async (event, userId, charId) => {
        try {
            // Enforce a maximum of 3 characters per user
            const userAssociations = associations.filter(assoc => assoc.userId === userId);
            if (userAssociations.length >= 3) {
                throw new Error(`User ID ${userId} already has the maximum of 3 associated characters.`);
            }

            // Check if the character is already associated
            const existingAssoc = associations.find(assoc => assoc.charId === charId);
            if (existingAssoc) {
                throw new Error(`Character ID ${charId} is already associated with User ID ${existingAssoc.userId}.`);
            }

            // Find the character name from mappings
            let charName = 'Unknown';
            const { mappings } = await loadMappings();

            for (const mapping of mappings) {
                const foundChar = mapping.availableCharFiles.find(char => char.charId === charId);
                if (foundChar) {
                    charName = foundChar.name;
                    break;
                }
            }

            // Associate the character with the user
            associations.push({
                userId,
                charId,
                charName
            });

            // Save the updated associations
            await saveAssociations(associations);

            return { success: true, message: `Character ID ${charId} associated with User ID ${userId}.` };
        } catch (error) {
            console.error('Error associating character:', error);
            return { success: false, message: error.message };
        }
    });

    // Handle IPC for unassociating characters from users
    ipcMain.handle('unassociate-character', async (event, userId, charId) => {
        try {
            const index = associations.findIndex(assoc => assoc.userId === userId && assoc.charId === charId);
            if (index === -1) {
                throw new Error(`Association between User ID ${userId} and Character ID ${charId} not found.`);
            }

            // Remove the association
            associations.splice(index, 1);

            // Save the updated associations
            await saveAssociations(associations);

            return { success: true, message: `Character ID ${charId} has been unassociated from User ID ${userId}.` };
        } catch (error) {
            console.error('Error unassociating character:', error);
            return { success: false, message: error.message };
        }
    });

    // Handle resetting to the default directory
    ipcMain.handle('reset-to-default-directory', async () => {
        try {
            const platform = process.platform;
            const wslDetected = await isWSL();

            // Determine the default directory
            let defaultDir;
            if (wslDetected) {
                const windowsHome = await getWindowsHomeInWSL();
                console.log(windowsHome);
                defaultDir = path.join(windowsHome, 'AppData', 'Local', 'CCP', 'EVE', 'c_ccp_eve_online_tq_tranquility');
            } else {
                defaultDir = defaultPaths[platform];
            }

            // Check if default directory exists
            const dirExists = await fs.access(defaultDir).then(() => true).catch(() => false);
            if (!dirExists) {
                throw new Error(`Default directory does not exist: ${defaultDir}`);
            }

            // Set settingsDir to the default directory
            settingsDir = defaultDir;
            console.log(`Reset to default directory: ${settingsDir}`);

            // Save the default directory to the settings file
            await saveSettingsDirectory(settingsDir);

            // Return the directory back to the renderer process for further UI updates
            return { success: true, settingsDir };
        } catch (error) {
            console.error('Failed to reset directory to default:', error);
            return { success: false, message: error.message };
        }
    });


    ipcMain.handle('sync-subdirectory', async (event, subDir, userFileName, charFileName) => {
        try {
            // Use subDir as is
            const subDirPath = path.join(settingsDir, subDir);

            // Check if subDirPath exists
            const subDirExists = await fs.access(subDirPath).then(() => true).catch(() => false);
            if (!subDirExists) {
                throw new Error(`Subdirectory does not exist: ${subDirPath}`);
            }

            // Get the full paths of the selected user and character files
            const selectedUserFilePath = path.join(subDirPath, `core_user_${userFileName}.dat`);
            const selectedCharFilePath = path.join(subDirPath, `core_char_${charFileName}.dat`);

            // Check if files exist
            const userFileExists = await fs.access(selectedUserFilePath).then(() => true).catch(() => false);
            const charFileExists = await fs.access(selectedCharFilePath).then(() => true).catch(() => false);

            if (!userFileExists) {
                console.warn(`Selected user file does not exist: ${selectedUserFilePath}`);
            }
            if (!charFileExists) {
                console.warn(`Selected character file does not exist: ${selectedCharFilePath}`);
            }

            // Read the contents of the selected user and character files
            const userFileContent = userFileExists ? await fs.readFile(selectedUserFilePath) : null;
            const charFileContent = charFileExists ? await fs.readFile(selectedCharFilePath) : null;

            // Get all files in the subdirectory
            const files = await fs.readdir(subDirPath);

            // Initialize counters
            let userFilesCopied = 0;
            let charFilesCopied = 0;

            // Loop over the files and copy the contents
            for (const file of files) {
                const fullFilePath = path.join(subDirPath, file);

                try {
                    if (file.startsWith('core_user_') && file.endsWith('.dat') && file !== `core_user_${userFileName}.dat`) {
                        if (userFileContent) {
                            await fs.writeFile(fullFilePath, userFileContent);
                            userFilesCopied++;
                        } else {
                            console.warn(`User file content is null, skipping file: ${fullFilePath}`);
                        }
                    } else if (file.startsWith('core_char_') && file.endsWith('.dat') && file !== `core_char_${charFileName}.dat`) {
                        if (charFileContent) {
                            await fs.writeFile(fullFilePath, charFileContent);
                            charFilesCopied++;
                        } else {
                            console.warn(`Character file content is null, skipping file: ${fullFilePath}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error copying to file ${fullFilePath}:`, error);
                    // Continue to next file
                }
            }

            const message = `Synchronization complete in "${subDir}", ${userFilesCopied} user files copied and ${charFilesCopied} character files copied.`;
            console.log(message);

            return { success: true, message };

        } catch (error) {
            console.error(`Error syncing subdirectory "${subDir}":`, error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('sync-all-subdirectories', async (event, subDir, userFileName, charFileName) => {
        try {
            console.log(`Syncing all subdirectories using files from subdirectory: ${subDir}`);
            
            const subDirPath = path.join(settingsDir, subDir);
        
            // Check if subDirPath exists
            const subDirExists = await fs.access(subDirPath).then(() => true).catch(() => false);
            if (!subDirExists) {
                throw new Error(`Subdirectory does not exist: ${subDirPath}`);
            }
        
            const selectedUserFilePath = path.join(subDirPath, `core_user_${userFileName}.dat`);
            const selectedCharFilePath = path.join(subDirPath, `core_char_${charFileName}.dat`);

            console.log(`Using user file: ${selectedUserFilePath} and character file: ${selectedCharFilePath}`);

            const userFileContent = await fs.readFile(selectedUserFilePath);
            const charFileContent = await fs.readFile(selectedCharFilePath);

            // Loop through all subdirectories to sync the files
            const subDirs = await fs.readdir(settingsDir);

            // Initialize counters
            let userFilesCopied = 0;
            let charFilesCopied = 0;

            for (const otherSubDir of subDirs) {
                if (otherSubDir === subDir) continue; // Skip the current subdirectory
                const otherSubDirPath = path.join(settingsDir, otherSubDir);

                try {
                    const otherFiles = await fs.readdir(otherSubDirPath);

                    // Sync user files
                    for (const otherFile of otherFiles) { 
                        if (otherFile.startsWith('core_user_') && otherFile.endsWith('.dat')) {
                            await fs.writeFile(path.join(otherSubDirPath, otherFile), userFileContent);
                            userFilesCopied++;
                            console.log(`Synced user file to: ${otherFile} in "${otherSubDir}"`);
                        }
                    }

                    // Sync character files
                    for (const otherFile of otherFiles) {
                        if (otherFile.startsWith('core_char_') && otherFile.endsWith('.dat')) {
                            await fs.writeFile(path.join(otherSubDirPath, otherFile), charFileContent);
                            charFilesCopied++;
                            console.log(`Synced character file to: ${otherFile} in "${otherSubDir}"`);
                        }
                    }

                } catch (error) {
                    console.error(`Error syncing files for subdirectory: "${otherSubDir}":`, error);
                }
            }

            const message = `Sync completed for all subdirectories: ${userFilesCopied} user files copied and ${charFilesCopied} character files copied, based on user/char files from "${subDir}".`;
            console.log(message);

            return { success: true, message };

        } catch (error) {
            console.error('Error syncing all subdirectories:', error);
            return { success: false, message: error.message };
        }
    });



    // Handle backup directory request
    ipcMain.handle('backup-directory', async (event, targetDir) => {
        try {
            const backupResult = await backupDirectory(targetDir);
            return backupResult;
        } catch (error) {
            console.error('Error creating backup:', error);
            return { success: false, message: 'Backup failed: ' + error.message };
        }
    });

    // Handle delete backups request
    ipcMain.handle('delete-backups', async () => {
        try {
            const result = await deleteBackups();
            return result;
        } catch (error) {
            console.error('Error deleting backups:', error);
            return { success: false, message: 'Failed to delete backups: ' + error.message };
        }
    });

}

// Call the function to register IPC handlers
registerIpcHandlers();

const selectionsPath = path.join(app.getPath('userData'), 'userSelections.json');

function getLastTwoDirs(fullPath) {
    const parts = fullPath.split(/[/\\]/);
    return parts.slice(-2).join('/');
}

// Helper function to load user selections from file
async function loadUserSelections() {
    try {
        const data = await fs.readFile(selectionsPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // If the file doesn't exist, return an empty object
        return {};
    }
}

// Helper function to save user selections to file
async function saveUserSelections(selections) {
    try {
        await fs.writeFile(selectionsPath, JSON.stringify(selections, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving user selections:', error);
    }
}


// Function to load settings data
async function loadSettings() {
    await loadCachesAndAssociations();

    let subDirs;
    try {
        subDirs = await fs.readdir(settingsDir);
    } catch (error) {
        console.error(`Error reading settings directory ${settingsDir}:`, error);
        subDirs = [];
    }

    // Only keep directories that start with "settings_"
    const filteredSubDirs = subDirs.filter(dir => dir.startsWith('settings_'));

    const settingsData = [];
    for (const subDir of filteredSubDirs) {
        const fullSubDirPath = path.join(settingsDir, subDir);
        let stats;
        try {
            stats = await fs.lstat(fullSubDirPath);
        } catch (error) {
            console.error(`Error getting stats for subdirectory ${fullSubDirPath}:`, error);
            continue;
        }

        if (stats.isDirectory()) {
            const { availableCharFiles, availableUserFiles } = await getFilesForDropdown(subDir);
            settingsData.push({
                subDir,  // Use the full subdirectory name
                availableCharFiles: Array.isArray(availableCharFiles) ? availableCharFiles : [],
                availableUserFiles: Array.isArray(availableUserFiles) ? availableUserFiles : []
            });
        }
    }

    // Log summary of failed HTTP requests
    if (failedHTTPRequests > 0) {
        console.warn(`Total failed HTTP requests (character names not found): ${failedHTTPRequests}`);
        failedHTTPRequests = 0; // Reset counter after logging
    }

    return {
        settingsData: Array.isArray(settingsData) ? settingsData : [],
        associations,
        currentSettingsDir: settingsDir // Added current settings directory
    };
}

/**
 * Create a compressed backup of the specified directory (settingsDir).
 * @param {string} targetDir - The directory to back up.
 * @returns {Object} Result of the backup operation.
 */
async function backupDirectory(targetDir) {
    try {
        // Get the current date and time in a human-readable format
        const now = new Date();
        const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

        // Create the backup file name with the human-readable date
        const backupDirName = `${path.basename(targetDir)}_${formattedDate}.bak.tar.gz`;
        const backupDirPath = path.join(app.getPath('userData'), backupDirName);

        console.log(`Creating backup at: ${backupDirPath}`);

        // Correct path to the directory we want to back up
        const backupSourceDir = path.resolve(targetDir);  // This ensures we only back up the correct targetDir

        await tar.c(
            {
                gzip: true,
                file: backupDirPath,
                cwd: path.dirname(backupSourceDir),  // Set the current working directory to the parent of the settingsDir
            },
            [path.basename(backupSourceDir)]  // Backup only the basename (i.e., the "settings" folder)
        );

        console.log(`Backup created successfully at: ${backupDirPath}`);
        return { success: true, message: `Backup created successfully at: ${backupDirPath}` };
    } catch (error) {
        console.error(`Error creating backup: ${error.message}`);
        return { success: false, message: `Error creating backup: ${error.message}` };
    }
}


/**
 * Function to delete all backup files (.bak.tar.gz) in the user data directory.
 * @returns {Object} Result of the delete operation.
 */
async function deleteBackups() {
    try {
        const userDataPath = app.getPath('userData');
        const files = await fs.readdir(userDataPath);

        // Filter backup files
        const backupFiles = files.filter(file => file.endsWith('.bak.tar.gz'));

        // Delete each backup file
        for (const file of backupFiles) {
            await fs.unlink(path.join(userDataPath, file));
            console.log(`Deleted backup file: ${file}`);
        }

        return { success: true, message: 'All backups deleted successfully.' };
    } catch (error) {
        console.error(`Error deleting backups: ${error.message}`);
        return { success: false, message: `Failed to delete backups: ${error.message}` };
    }
}

/**
 * Function to detect if running in WSL
 */
async function isWSL() {
    const platform = os.platform();
    if (platform === 'linux') {
        try {
            const version = await fs.readFile('/proc/version', 'utf8');
            return version.includes('microsoft');
        } catch (err) {
            return false;
        }
    }
    return false;
}

/**
 * Function to get Windows home directory when running in WSL
 */
async function getWindowsHomeInWSL() {
    return new Promise((resolve, reject) => {
        exec('cmd.exe /C "echo %USERPROFILE%"', (error, stdout, stderr) => {
            if (error) {
                return reject(new Error('Failed to retrieve Windows home directory in WSL.'));
            }

            // Remove any carriage return and newline characters
            const windowsHome = stdout.trim().replace(/\\/g, '/');
            // Convert to WSL path
            exec(`wslpath -u ${windowsHome}`, (wslError, wslPath) => {
                if (wslError) {
                    return reject(new Error('Failed to convert Windows home path to WSL format.'));
                }
                resolve(wslPath.trim());
            });
        });
    });
}

/**
 * Function to load user settings or set default directory
 */
async function loadSettingsDirectory() {
    try {
        const settingsData = await fs.readFile(settingsFilePath, 'utf8').catch(() => '{}');
        const userSettings = JSON.parse(settingsData);
        let isDefaultDir = false;

        // Check if the user has previously selected a directory
        if (userSettings && userSettings.settingsDir) {
            settingsDir = userSettings.settingsDir;
            console.log(`Using saved directory: ${settingsDir}`);

            // Check if it's the default path
            if (await checkIfDefaultDirectory(settingsDir)) {
                isDefaultDir = true;
            }
        } else {
            // No saved directory, use the default for the current OS
            const platform = process.platform;

            const isWSLDetected = await isWSL();
            let defaultDir;

            if (isWSLDetected) {
                defaultDir = path.join('/mnt/c', 'Users', os.userInfo().username, 'AppData', 'Local', 'CCP', 'EVE', 'c_ccp_eve_online_tq_tranquility');
                console.log(`Detected WSL, using Windows path adjusted for WSL: ${defaultDir}`);
            } else {
                defaultDir = defaultPaths[platform];
            }

            // Check if default directory exists, if so, use it
            const dirExists = await fs.access(defaultDir).then(() => true).catch(() => false);
            if (dirExists) {
                settingsDir = defaultDir;
                isDefaultDir = true;
                console.log(`Using default directory for platform (${platform}): ${settingsDir}`);
            } else {
                console.log(`Default directory for platform (${platform}) does not exist.`);
            }
        }

        // Send the result to the renderer process, indicating if it's the default directory
        return { success: true, settingsDir, isDefaultDir };

    } catch (error) {
        console.error('Error loading settings directory:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Check if the provided directory is the default directory based on the platform.
 * @param {string} dir - Directory path to check.
 * @returns {boolean} - True if default, else false.
 */
async function checkIfDefaultDirectory(dir) {
    const platform = process.platform;
    const isWSLDetected = await isWSL();

    if (isWSLDetected) {
        const windowsHome = await getWindowsHomeInWSL();
        const expectedDir = path.join(windowsHome, 'AppData', 'Local', 'CCP', 'EVE', 'c_ccp_eve_online_tq_tranquility');
        console.log("dir: ", dir, "expected: ", expectedDir, "returning: ", dir==expectedDir)
        return dir === expectedDir;
    } else {
        return dir === defaultPaths[platform];
    }
}

/**
 * Save user-selected settings directory to settings.json
 */
async function saveSettingsDirectory(newDir) {
    try {
        console.log(`Saving settings directory: ${newDir}`); // Log the directory being saved

        const settingsData = await fs.readFile(settingsFilePath, 'utf8').catch(() => '{}');
        const userSettings = JSON.parse(settingsData);

        // Log the current content of settings.json
        console.log(`Current settings data before saving: ${JSON.stringify(userSettings)}`);

        userSettings.settingsDir = newDir;  // Store the selected directory

        await fs.writeFile(settingsFilePath, JSON.stringify(userSettings, null, 2), 'utf8');
        console.log(`Settings directory saved successfully to: ${settingsFilePath}`);
    } catch (error) {
        console.error('Error saving settings directory:', error);
    }
}

// Helper function to get character and user files from subdirectories
async function getFilesForDropdown(subDir) {
    const directory = path.join(settingsDir, subDir);
    let files;
    try {
        files = await fs.readdir(directory);
    } catch (error) {
        console.error(`Error reading directory ${directory}:`, error);
        return { availableCharFiles: [], availableUserFiles: [] };
    }

    const charFiles = [];
    const userFiles = [];

    for (const file of files) {
        const fullFilePath = path.join(directory, file);
        let stats;
        try {
            stats = await fs.stat(fullFilePath);
        } catch (error) {
            console.error(`Error getting stats for file ${fullFilePath}:`, error);
            continue;
        }
        const mtime = stats.mtime.toISOString();

        if (file.startsWith('core_char_') && file.endsWith('.dat')) {
            const charId = file.replace('core_char_', '').replace('.dat', '');
            if (!/^\d+$/.test(charId)) {
                // console.warn(`Invalid character ID in file ${file}. Skipping.`);
                continue;
            }
            const charName = await getCharacterName(charId, fullFilePath);

            charFiles.push({
                file,
                charId,
                name: charName ? `${charName}` : `Unknown (${charId})`,
                mtime
            });
        } else if (file.startsWith('core_user_') && file.endsWith('.dat')) {
            const userId = file.replace('core_user_', '').replace('.dat', '');
            if (!/^\d+$/.test(userId)) {
                // console.warn(`Invalid user ID in file ${file}. Skipping.`);
                continue;
            }
            userFiles.push({
                file,
                userId,
                name: userId,
                mtime
            });
        } else {
           // console.warn(`File ${file} does not match expected patterns. Skipping.`);
            continue;
        }
    }

    return { availableCharFiles: charFiles, availableUserFiles: userFiles };
}


// Load config on app start
app.whenReady().then(async () => {
    try {
        await loadSettingsDirectory();  // Calling async function to load the directory
        await loadCachesAndAssociations(); // Load caches and associations on startup
        createWindow();
    } catch (error) {
        console.error('Failed to start application:', error);
    }

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
