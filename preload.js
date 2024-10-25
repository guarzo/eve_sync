// preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Methods for Main Page
    loadSettingsData: () => ipcRenderer.invoke('load-settings'),

    chooseSettingsDir: () => ipcRenderer.invoke('choose-settings-dir'),

    onSettingsDirChanged: (callback) => {
        ipcRenderer.on('update-directory-button', (event, newDir) => {
            callback(newDir);
        });
    },

    navigateTo: (page) => {
        ipcRenderer.send('navigate-to', page);
    },

    associateCharacter: (userId, charId) => ipcRenderer.invoke('associate-character', userId, charId),

    // Methods for Backup
    backupDirectory: (targetDir) => ipcRenderer.invoke('backup-directory', targetDir),
    deleteBackups: () => ipcRenderer.invoke('delete-backups'),

    // Associations
    unassociateCharacter: (userId, charId) => ipcRenderer.invoke('unassociate-character', userId, charId),

    syncSubdirectory: (subDir, userFile, charFile) => ipcRenderer.invoke('sync-subdirectory', subDir, userFile, charFile),

    syncAllSubdirectories: (subDir, userFileName, charFileName) => ipcRenderer.invoke('sync-all-subdirectories', subDir, userFileName, charFileName),

    // Methods for the Mapping Page
    loadMappings: () => ipcRenderer.invoke('load-mappings'),

    loadUserSelections: () => ipcRenderer.invoke('load-user-selections'),
    saveUserSelections: (selections) => ipcRenderer.invoke('save-user-selections', selections),

    resetToDefaultDirectory: () => ipcRenderer.invoke('reset-to-default-directory'),
    checkIfDefaultDirectory: (dir) => ipcRenderer.invoke('check-if-default-directory', dir),

    // Listen for Sync Success/Failure (if these events are used)
    onSyncSuccess: (callback) => {
        ipcRenderer.on('sync-success', (event, message) => {
            callback(message);
        });
    },
    onSyncFailure: (callback) => {
        ipcRenderer.on('sync-failure', (event, message) => {
            callback(message);
        });
    },
});
