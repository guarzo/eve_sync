// renderer.js

window.addEventListener('DOMContentLoaded', () => {

    // Define userSelections globally to store selections
    let userSelections = {};

    // Load selections function (to load saved selections)
    function loadSelections() {
        userSelections = JSON.parse(localStorage.getItem('userSelections') || '{}');
        console.log('Loaded selections:', userSelections);
    }

    // Save selection function (to save selections)
    function saveSelection(subDir, charId, userId) {
        userSelections[subDir] = { charId, userId };
        localStorage.setItem('userSelections', JSON.stringify(userSelections));
        console.log(`Saved selections for ${subDir}: Character - ${charId}, User - ${userId}`);
    }

    // Load selections on DOMContentLoaded
    loadSelections();

    // Configure Toastr options
    toastr.options = {
        closeButton: false,
        progressBar: true,
        positionClass: "toast-top-right",
        timeOut: 3000, // Reduced time for quicker feedback
        extendedTimeOut: 1000,
        preventDuplicates: true,
        showDuration: 200,
        hideDuration: 200,
        newestOnTop: true,
    };

    let globalAssociations = [];

    // Reference to container elements
    const usersContainer = document.getElementById('users-container');
    const charactersContainer = document.getElementById('characters-container');

    // Load data and render users and characters
    async function loadDataAndRender() {
        try {
            // Show loading spinner
            showLoadingSpinner(true);

            // Show the top buttons after loading starts
            const topButtons = document.getElementById('top-buttons');
            topButtons.style.display = 'none'; // Ensure buttons are hidden during loading

            // Load mappings (associations) from the main process
            const mappingsData = await window.electronAPI.loadSettingsData();
            const { settingsData, associations, currentSettingsDir, isDefaultDir } = mappingsData;
            globalAssociations = associations;

            await updateDirButtonText(currentSettingsDir); // Use the new logic here

            // Render subdirectories
            renderSubdirectories('subdirectories-container', settingsData, associations);

            // Show the top buttons after data has been loaded and rendered
            topButtons.style.display = 'flex'; // Change to 'flex' or appropriate display type

            // Hide loading spinner after rendering
            showLoadingSpinner(false);
        } catch (error) {
            console.error('Error loading settings:', error);
            toastr.error('Error loading settings');
            showLoadingSpinner(false);
        }
    }

    function renderSubdirectories(containerId, settingsData, associations) {
        const container = document.getElementById(containerId);
        container.innerHTML = ''; // Clear previous content
        console.log('Rendering subdirectories...');

        settingsData.forEach(subDir => {
            const card = document.createElement('div');
            card.classList.add('card', 'subdirectory');
            card.setAttribute('data-subdir', subDir.subDir);

            card.innerHTML = `
                <h3>${subDir.subDir.replace('settings_', '')}</h3>
                <div class="controls">
                    <select id="char-select-${subDir.subDir}" aria-label="Select Character">
                        <option value="">-- Select Character --</option>
                        ${subDir.availableCharFiles.map(char => `<option value="${char.charId}">${char.name}</option>`).join('')}
                    </select>
                </div>
                <div class="controls">
                    <select id="user-select-${subDir.subDir}" aria-label="Select User">
                        <option value="">-- Select User --</option>
                        ${subDir.availableUserFiles.map(user => `<option value="${user.userId}">${user.userId}</option>`).join('')}
                    </select>
                </div>
                <div class="controls button-row">
                    <button class="sync-btn" data-subdir="${subDir.subDir}" aria-label="Sync" title="Sync selected character with user in this subdirectory">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button class="sync-all-btn" data-subdir="${subDir.subDir}" aria-label="Sync-All" title="Sync selected character with user across all subdirectories">
                        <i class="fas fa-sync"></i>
                    </button>
                </div>
            `;

            container.appendChild(card);
        });

        attachSyncButtonListeners();
        setupCharacterDropdownListeners();
    }

    function attachSyncButtonListeners() {
        const syncButtons = document.querySelectorAll('.sync-btn');
        syncButtons.forEach(button => {
            button.addEventListener('click', async (event) => {
                const subDir = event.currentTarget.getAttribute('data-subdir');
                const charSelect = document.getElementById(`char-select-${subDir}`);
                const userSelect = document.getElementById(`user-select-${subDir}`);

                const charId = charSelect.value;
                const userId = userSelect.value;

                if (!userId || !charId) {
                    toastr.error('Please select both a user and a character to sync.');
                    return;
                }

                // Retrieve the selected character's name
                const charName = charSelect.options[charSelect.selectedIndex].text;

                // Show confirmation modal using SweetAlert2
                const confirmSync = await showConfirmationModal(`Use "${charName}""${charId}" on account ${userId} to overwrite all files in profile "${subDir}"?`);
                if (!confirmSync) return;

                try {
                    // Show loading spinner during the association process
                    showLoadingSpinner(true);

                    toastr.info('Syncing...', { timeOut: 1500 });

                    const result = await window.electronAPI.syncSubdirectory(subDir, userId, charId);
                    if (result.success) {
                        toastr.success(result.message);
                    } else {
                        toastr.error(`Sync failed: ${result.message}`);
                    }
                } catch (error) {
                    console.error('Error syncing:', error);
                    toastr.error('Sync operation failed.');
                } finally {
                    // Hide loading spinner after operation completes
                    showLoadingSpinner(false);
                }
            });
        });

        const syncAllButtons = document.querySelectorAll('.sync-all-btn');
        syncAllButtons.forEach(button => {
            button.addEventListener('click', async (event) => {
                const subDir = event.currentTarget.getAttribute('data-subdir');
                const charSelect = document.getElementById(`char-select-${subDir}`);
                const userSelect = document.getElementById(`user-select-${subDir}`);

                const charId = charSelect.value;
                const userId = userSelect.value;

                if (!userId || !charId) {
                    toastr.error('Please select both a user and a character to sync-all.');
                    return;
                }

                // Retrieve the selected character's name
                const charName = charSelect.options[charSelect.selectedIndex].text;

                // Show confirmation modal using SweetAlert2
                const confirmSync = await showConfirmationModal(`Use "${charName}" with ${userId} to overwrite files across all profiles?`);
                if (!confirmSync) return;

                try {
                    // Show loading spinner during the sync-all process
                    showLoadingSpinner(true);

                    // Perform the sync-all operation
                    const result = await window.electronAPI.syncAllSubdirectories(subDir, userId, charId);
                    if (result.success) {
                        toastr.success(result.message);
                    } else {
                        toastr.error(`Sync-All failed: ${result.message}`);
                    }
                } catch (error) {
                    console.error('Error syncing-all:', error);
                    toastr.error('Sync-All operation failed.');
                } finally {
                    // Hide loading spinner after operation completes
                    showLoadingSpinner(false);
                }
            });
        });

        document.getElementById('reset-to-default-btn').addEventListener('click', async () => {
            const confirmReset = await showConfirmationModal('Are you sure you want to reset the settings directory to default (Tranquility)?');
            if (!confirmReset) return;
        
            try {
                showLoadingSpinner(true);
        
                const result = await window.electronAPI.resetToDefaultDirectory();
                if (result.success) {
                    toastr.success('Directory reset to default: Tranquility');
                    await updateDirButtonText(result.settingsDir); // Update the button after resetting
                    await loadDataAndRender();  // Reload the page after resetting to default
                } else {
                    toastr.error(`Failed to reset directory: ${result.message}`);
                }
            } catch (error) {
                console.error('Error resetting directory:', error);
                toastr.error('Failed to reset directory. Please try again.');
            } finally {
                showLoadingSpinner(false);
            }
        });
        
    }

    // Setup dropdown listeners and load previous selections
function setupCharacterDropdownListeners() {
    const subdirCards = document.querySelectorAll('.card.subdirectory');
    subdirCards.forEach(card => {
        const subDir = card.getAttribute('data-subdir') || '';
        const charSelect = card.querySelector(`select[id^="char-select-${subDir}"]`);
        const userSelect = card.querySelector(`select[id^="user-select-${subDir}"]`);

        // Load previous selections for this subDir
        const savedSelection = userSelections[subDir];
        if (savedSelection) {
            charSelect.value = savedSelection.charId;
            userSelect.value = savedSelection.userId;
        }

        if (charSelect && userSelect) {
            charSelect.addEventListener('change', (event) => {
                const selectedCharId = event.target.value;
                if (!selectedCharId) {
                    userSelect.value = '';
                    return;
                }

                const assoc = globalAssociations.find(a => a.charId === selectedCharId);
                if (assoc) {
                    userSelect.value = assoc.userId;
                } else {
                    userSelect.value = '';
                }
            });
        }

        // Save the selections when changed
        if (charSelect && userSelect) {
            charSelect.addEventListener('change', (event) => {
                const selectedCharId = event.target.value;
                const selectedUserId = userSelect.value;
                saveSelection(subDir, selectedCharId, selectedUserId);
            });

            userSelect.addEventListener('change', (event) => {
                const selectedUserId = event.target.value;
                const selectedCharId = charSelect.value;
                saveSelection(subDir, selectedCharId, selectedUserId);
            });
        }
    });
}

    // Navigation Handler
    function handleNavigation() {
        const navigateButton = document.getElementById('character-mapping-btn');
        if (navigateButton && !navigateButton.hasListener) { // Prevent duplicate listeners
            navigateButton.addEventListener('click', () => {
                window.electronAPI.navigateTo('mapping.html'); // Adjust the path as necessary
            });
            navigateButton.hasListener = true;
        } else {
            console.error('Navigate button not found or already has a listener');
        }
    }

    // Handle Choosing Settings Directory
    function handleChooseSettingsDir() {
        const settingsDirButton = document.getElementById('choose-settings-dir');
        settingsDirButton.addEventListener('click', async () => {
            const result = await window.electronAPI.chooseSettingsDir();
            if (result.success) {
                await updateDirButtonText(result.settingsDir); // Ensure we use the updated function here
                await loadDataAndRender(); // Reload data with the new directory
            } else {
                toastr.error('Failed to change the directory.');
            }
        });

        // // Listen for directory changes
        // window.electronAPI.onSettingsDirChanged((newDir) => {
        //     if (newDir === 'Tranquility') {
        //         updateDirButtonText('Tranquility');
        //     } else {
        //         updateDirButtonText(newDir);
        //     }
        //     document.getElementById('reset-to-default-btn').style.display = 'inline-flex'; 
        //     loadDataAndRender(); // Reload settings after directory change
        // });
    }

    // Update Directory Button Tooltip Text
    async function updateDirButtonText(text) {
        const settingsDirButton = document.getElementById('choose-settings-dir');
        const resetBtn = document.getElementById('reset-to-default-btn');

        if (settingsDirButton) {
            // Check if the current directory is the default one
            const isDefaultDir = await window.electronAPI.checkIfDefaultDirectory(text);

            if (isDefaultDir) {
                settingsDirButton.setAttribute('data-subdir', 'Tranquility'); // Change text to 'Tranquility'
                resetBtn.style.display = 'none'; // Hide reset button
            } else {
                settingsDirButton.setAttribute('data-subdir', text); // Show actual directory text
                resetBtn.style.display = 'inline-flex'; // Show reset button
            }
        }
    }

    // Handle Backup Settings
    function handleBackupSettings() {
        const backupBtn = document.getElementById('backup-btn');
        backupBtn.addEventListener('click', async () => {
            const confirmBackup = await showConfirmationModal('Are you sure you want to backup your settings?');
            if (!confirmBackup) return;

            try {
                // Show loading spinner during the backup process
                showLoadingSpinner(true);

                const settingsDirButton = document.getElementById('choose-settings-dir');
                const currentDir = settingsDirButton.getAttribute('data-subdir') || '';
                const result = await window.electronAPI.backupDirectory(currentDir);
                if (result.success) {
                    toastr.success(result.message);
                } else {
                    toastr.error(`Backup failed: ${result.message}`);
                }
            } catch (error) {
                console.error('Error during backup:', error);
                toastr.error('Backup operation failed.');
            } finally {
                // Hide loading spinner after operation completes
                showLoadingSpinner(false);
            }
        });
    }

    // Handle Delete Backups
    function handleDeleteBackups() {
        const deleteBackupBtn = document.getElementById('delete-backup-btn');
        deleteBackupBtn.addEventListener('click', async () => {
            const confirmDelete = await showConfirmationModal('Are you sure you want to delete all backups?');
            if (!confirmDelete) return;

            try {
                // Show loading spinner during the delete process
                showLoadingSpinner(true);

                const result = await window.electronAPI.deleteBackups();
                if (result.success) {
                    toastr.success(result.message);
                } else {
                    toastr.error(`Delete backups failed: ${result.message}`);
                }
            } catch (error) {
                console.error('Error deleting backups:', error);
                toastr.error('Delete backups operation failed.');
            } finally {
                // Hide loading spinner after operation completes
                showLoadingSpinner(false);
            }
        });
    }

    // Initialize dark mode based on saved preference
    function initializeDarkMode() {
        const toggleDarkModeButton = document.getElementById('toggle-dark-mode');

        // Check for saved dark mode preference
        if (localStorage.getItem('darkMode') === 'enabled') {
            document.body.classList.add('dark-mode');
            toggleDarkModeButton.innerHTML = '<i class="fas fa-sun"></i>';
            toggleDarkModeButton.setAttribute('title', 'Light Mode');
        }

        toggleDarkModeButton.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem('darkMode', 'enabled');
                toggleDarkModeButton.innerHTML = '<i class="fas fa-sun"></i>';
                toggleDarkModeButton.setAttribute('title', 'Light Mode');
            } else {
                localStorage.setItem('darkMode', 'disabled');
                toggleDarkModeButton.innerHTML = '<i class="fas fa-moon"></i>';
                toggleDarkModeButton.setAttribute('title', 'Dark Mode');
            }
        });
    }

    // Show or hide the loading spinner
    function showLoadingSpinner(show) {
        const spinner = document.getElementById('loading-spinner');
        if (spinner) {
            if (show) {
                spinner.classList.add('visible');
            } else {
                spinner.classList.remove('visible');
            }
        }
    }

    // Initialize the data loading and rendering process
    loadDataAndRender();
    handleNavigation();
    handleChooseSettingsDir();
    handleBackupSettings();
    handleDeleteBackups();
    initializeDarkMode();

    /**
     * Function to show a custom confirmation modal using SweetAlert2
     * @param {string} message - The confirmation message to display
     * @returns {Promise<boolean>} - Resolves to true if confirmed, false otherwise
     */
    async function showConfirmationModal(message) {
        // Ensure SweetAlert2 is loaded
        if (typeof Swal === 'undefined') {
            console.error('SweetAlert2 is not loaded.');
            return false;
        }

        const result = await Swal.fire({
            title: 'Confirm',
            text: message,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes',
            cancelButtonText: 'No',
            reverseButtons: false,
            customClass: {
                popup: 'custom-modal',
                confirmButton: 'btn btn-primary',
                cancelButton: 'btn btn-secondary'
            },
            buttonsStyling: false
        });

        return result.isConfirmed;
    }
});
