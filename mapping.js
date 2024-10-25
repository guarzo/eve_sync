// mapping.js

window.addEventListener('DOMContentLoaded', () => {
    // Configure Toastr options for consistent user feedback
    toastr.options = {
        closeButton: true, // Enable close button for user control
        progressBar: true,  // Show a progress bar for timing
        positionClass: "toast-top-right", // Position toasts at the top-right
        timeOut: 3000, // Reduced auto-dismiss time for faster feedback
        extendedTimeOut: 1000, // Additional time if the user hovers
        preventDuplicates: true, // Avoid showing duplicate messages
        showDuration: 200,  // Faster animation time when showing the toast
        hideDuration: 200,  // Faster animation time when hiding the toast
        newestOnTop: true,  // Ensure new toasts appear at the top
        rtl: false // Left-to-right layout
    };
    
    let associations = [];
    let allUsers = [];
    let allCharacters = [];

    // Reference to container elements
    const usersContainer = document.getElementById('users-container');
    const charactersContainer = document.getElementById('characters-container');

    // Load data and render users and characters
    async function loadDataAndRender() {
        try {
            // Show loading spinner
            showLoadingSpinner(true);

            // Load mappings (associations) from the main process
            const mappingsData = await window.electronAPI.loadMappings();
            const { mappings, associations: loadedAssociations } = mappingsData;
            associations = loadedAssociations;

            // Process and render users and characters with color indicators
            processAndRenderData(mappings, associations);

            // Hide loading spinner after data is loaded
            showLoadingSpinner(false);
        } catch (error) {
            console.error('Error loading data:', error);
            toastr.error('Failed to load data.');
            showLoadingSpinner(false);
        }
    }

    // Process mappings and render data
    function processAndRenderData(mappings, associations) {
        // Flatten all user and character files across mappings
        allUsers = [];
        allCharacters = [];

        mappings.forEach(mapping => {
            allUsers = allUsers.concat(mapping.availableUserFiles.map(user => ({
                ...user,
                subDir: mapping.subDir
            })));
            allCharacters = allCharacters.concat(mapping.availableCharFiles.map(char => ({
                ...char,
                subDir: mapping.subDir
            })));
        });

        // Deduplicate users and characters, keeping only the latest mtime
        allUsers = deduplicateById(allUsers, 'userId');
        allCharacters = deduplicateById(allCharacters, 'charId');

        // Filter out associated characters from the characters list
        const associatedCharIds = associations.map(assoc => assoc.charId);
        const availableCharacters = allCharacters.filter(char => !associatedCharIds.includes(char.charId));

        // Proceed to render with the deduplicated and filtered lists
        renderUsersAndCharacters(allUsers, availableCharacters, associations);
    }

    // Deduplicate items based on a unique identifier and latest modification time
    function deduplicateById(items, idProp) {
        const itemMap = new Map();

        items.forEach(item => {
            const id = item[idProp];
            const existingItem = itemMap.get(id);

            if (!existingItem) {
                // Item not in map yet, add it
                itemMap.set(id, item);
            } else {
                // Compare mtimes to keep the latest one
                const existingMtime = new Date(existingItem.mtime).getTime();
                const currentMtime = new Date(item.mtime).getTime();

                if (currentMtime > existingMtime) {
                    // Current item is newer, replace existing
                    itemMap.set(id, item);
                }
            }
        });

        // Return the deduplicated items as an array
        return Array.from(itemMap.values());
    }

    /**
     * Function to retrieve character name by ID
     * Assumes that character data is stored and accessible
     * Modify this function based on your actual data structure
     * @param {string} charId
     * @returns {string} - Character name
     */
    function getCharacterNameById(charId) {
            const character = allCharacters.find(char => char.charId === charId);
            return character ? character.name : 'Unknown';
    }

    // Render users (accounts) and available characters
    function renderUsersAndCharacters(allUsers, availableCharacters, associations) {
        // Clear existing content
        usersContainer.innerHTML = '';
        charactersContainer.innerHTML = '';

        // Combine all files and group them based on `mtime`
        const allFiles = [
            ...allUsers.map(user => ({ type: 'user', ...user })),
            ...availableCharacters.map(char => ({ type: 'character', ...char }))
        ];

        // Group files by `mtime` within a threshold
        const timeThreshold = 1000 * 60 * 1; // 1 minute
        const groups = groupFilesByTime(allFiles, timeThreshold);

        // Assign a unique color to each group
        const colors = generateColors(groups.length);
        const groupColors = {};
        groups.forEach((group, index) => {
            group.forEach(file => {
                groupColors[file.file] = colors[index];
            });
        });

        // Render Users (Accounts) using DocumentFragment for performance
        const userFragment = document.createDocumentFragment();
        allUsers.forEach(user => {
            const userCard = createUserCard(user, groupColors[user.file], associations);
            userFragment.appendChild(userCard);
        });
        usersContainer.appendChild(userFragment);

        // Render Available Characters using DocumentFragment for performance
        const charFragment = document.createDocumentFragment();
        availableCharacters.forEach(char => {
            const charCard = createCharacterCard(char, groupColors[char.file]);
            charFragment.appendChild(charCard);
        });
        charactersContainer.appendChild(charFragment);

        // After rendering, attach event listeners
        attachUnassociateListeners();
    }

    // Create a user card element
    function createUserCard(user, borderColor, associations) {
        const userCard = document.createElement('div');
        userCard.classList.add('card', 'user', 'dropzone');
        userCard.setAttribute('data-user-id', user.userId);

        const lastUpdated = formatDate(user.mtime);

        // Set border color based on groupColors
        userCard.style.borderLeftColor = borderColor || 'var(--primary-color)';

        // Get associated characters
        const userAssociations = associations.filter(assoc => assoc.userId === user.userId);
        const associatedCharsHtml = userAssociations.map(assoc => {
            return `
                <li>
                    ${assoc.charName}
                    <button class="unassociate-btn" data-char-id="${assoc.charId}" aria-label="Unassociate ${assoc.charName}">
                        <i class="fas fa-times"></i>
                    </button>
                </li>
            `;
        }).join('');

        // Structure the user card with .card-header and associated characters list
        userCard.innerHTML = `
            <div class="card-header">
                <h3>ID: ${user.userId}</h3>
                <span class="last-updated">Last Updated: ${lastUpdated}</span>
            </div>
            <ul class="associated-characters">
                ${associatedCharsHtml}
            </ul>
        `;

        // Add drop zone event listeners for drag-and-drop
        addDropZoneEvents(userCard);

        return userCard;
    }

    // Create a character card element
    function createCharacterCard(char, borderColor) {
        const charCard = document.createElement('div');
        charCard.classList.add('card', 'character', 'draggable');
        charCard.setAttribute('draggable', 'true');
        charCard.setAttribute('data-char-id', char.charId);

        const lastUpdated = formatDate(char.mtime);

        // Set border color based on groupColors
        charCard.style.borderLeftColor = borderColor || 'var(--primary-color)';

        // Fix the character name duplication issue
        const charName = char.name.replace(/\s*\(\d+\)\s*\(\d+\)/, match => {
            const ids = match.match(/\d+/g);
            return ` (${ids[0]})`;
        });

        // Structure the character card with .card-header
        charCard.innerHTML = `
            <div class="card-header">
                <h3>${charName}</h3>
                <span class="last-updated">Last Updated: ${lastUpdated}</span>
            </div>
            <!-- Additional character details can be added here if needed -->
        `;

        // Add drag event listeners for drag-and-drop
        addDragEvents(charCard);

        return charCard;
    }

    // Format ISO date string to a readable format
    function formatDate(isoString) {
        const date = new Date(isoString);
        const options = {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric'
        };
        return date.toLocaleString(undefined, options);
    }

    // Group files by modification time within a threshold
    function groupFilesByTime(files, threshold) {
        // Sort files by `mtime`
        files.sort((a, b) => new Date(a.mtime) - new Date(b.mtime));

        const groups = [];
        let currentGroup = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileTime = new Date(file.mtime).getTime();

            if (currentGroup.length === 0) {
                currentGroup.push(file);
            } else {
                const lastFileTime = new Date(currentGroup[currentGroup.length - 1].mtime).getTime();
                if (Math.abs(fileTime - lastFileTime) <= threshold) {
                    currentGroup.push(file);
                } else {
                    groups.push(currentGroup);
                    currentGroup = [file];
                }
            }
        }

        if (currentGroup.length > 0) {
            groups.push(currentGroup);
        }

        return groups;
    }

    // Generate distinct colors for groups
    function generateColors(count) {
        const colors = [];
        const hueStep = Math.floor(360 / count);

        for (let i = 0; i < count; i++) {
            const hue = i * hueStep;
            colors.push(`hsl(${hue}, 70%, 80%)`);
        }

        return colors;
    }

    // Variables to track the dragged character
    let draggedCharId = null;

    // Add drag event listeners to character cards
    function addDragEvents(element) {
        element.addEventListener('dragstart', handleDragStart);
        element.addEventListener('dragend', handleDragEnd);
    }

    // Add drop zone event listeners to user (account) cards
    function addDropZoneEvents(element) {
        element.addEventListener('dragover', handleDragOver);
        element.addEventListener('drop', handleDrop);
        element.addEventListener('dragenter', handleDragEnter);
        element.addEventListener('dragleave', handleDragLeave);
    }

    // Handle drag start event
    function handleDragStart(event) {
        draggedCharId = event.target.getAttribute('data-char-id');
        event.dataTransfer.setData('text/plain', draggedCharId);
        event.dataTransfer.effectAllowed = 'move';
        event.target.classList.add('dragging');
    }

    // Handle drag end event
    function handleDragEnd(event) {
        event.target.classList.remove('dragging');
    }

    // Handle drag over event
    function handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }

    // Handle drag enter event
    function handleDragEnter(event) {
        event.preventDefault();
        event.currentTarget.classList.add('drag-over');
    }

    // Handle drag leave event
    function handleDragLeave(event) {
        event.currentTarget.classList.remove('drag-over');
    }

    // Handle drop event
    async function handleDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.remove('drag-over');

        const userId = event.currentTarget.getAttribute('data-user-id');
        const charId = draggedCharId;

        if (!userId || !charId) {
            toastr.error('Invalid association.');
            return;
        }

        // Show confirmation modal using SweetAlert2
        const charName = getCharacterNameById(charId)
        console.log("charname", charName)
        const confirmAssoc = await showConfirmationModal(`Associate ${charName} with Account ${userId}?`);
        if (!confirmAssoc) return;

        try {
            // Show loading spinner during the association process
            showLoadingSpinner(true);

            // Perform the association operation
            const result = await window.electronAPI.associateCharacter(userId, charId);
            if (result.success) {
                toastr.success('Character associated successfully.');

                // Reload mappings to reflect the new association
                await loadDataAndRender();
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
    }

    // Attach event listeners for unassociate buttons
    function attachUnassociateListeners() {
        usersContainer.addEventListener('click', async (event) => {
            const unassociateBtn = event.target.closest('.unassociate-btn');
            if (unassociateBtn) {
                const charId = unassociateBtn.getAttribute('data-char-id');
                const userCard = unassociateBtn.closest('.card.user');
                const userId = userCard ? userCard.getAttribute('data-user-id') : null;

                if (!userId || !charId) {
                    toastr.error('Invalid unassociation.');
                    return;
                }

                // Show confirmation modal using SweetAlert2
                const charName = getCharacterNameById(charId)
                console.log("charname", charName)
                const confirmUnassoc = await showConfirmationModal(`Unassociate ${charName} from Account ${userId}?`);
                if (!confirmUnassoc) return;

                try {
                    // Show loading spinner during the unassociation process
                    showLoadingSpinner(true);

                    // Perform the unassociation operation
                    const result = await window.electronAPI.unassociateCharacter(userId, charId);
                    if (result.success) {
                        toastr.success('Character unassociated successfully.');
                        await loadDataAndRender();
                    } else {
                        toastr.error(`Unassociation failed: ${result.message}`);
                    }
                } catch (error) {
                    console.error('Error unassociating character:', error);
                    toastr.error('Failed to unassociate character. Please try again.');
                } finally {
                    // Hide loading spinner after operation completes
                    showLoadingSpinner(false);
                }
            }
        });
    }

    // Handle Navigation Button
    function handleNavigation() {
        const navigateButton = document.getElementById('navigate-main');
        if (navigateButton && !navigateButton.hasListener) { // Prevent duplicate listeners
            navigateButton.addEventListener('click', () => {
                window.electronAPI.navigateTo('main.html'); // Adjust the path as necessary
            });
            navigateButton.hasListener = true;
        } else {
            console.error('Navigate button not found or already has a listener');
        }
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
    attachUnassociateListeners();
    handleNavigation();
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
                confirmButton: 'confirm-dialog-btn',  // Apply new class for dialog buttons
                cancelButton: 'confirm-dialog-btn'    // Apply new class for dialog buttons
            },
            buttonsStyling: false
        });

        return result.isConfirmed;
    }
});
