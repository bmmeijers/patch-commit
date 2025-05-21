import { compare } from 'https://cdn.jsdelivr.net/npm/fast-json-patch/+esm';

let originalContent = '';
let currentHash = '';
let currentRepo = '';
let currentFile = '';

/**
 * Fetches the list of available repositories and JSON files.
 */
export async function fetchRepos() {
    const response = await fetch('/repos');
    const repos = await response.json();

    const repoSelect = document.getElementById('repoSelect');
    repoSelect.innerHTML = repos
        .map(repo => `<option value="${repo}">${repo}</option>`)
        .join('');

    repoSelect.addEventListener('change', () => {
        currentRepo = repoSelect.value;
        updateFileList(repos[currentRepo]?.files || []);
        fetchFilesForRepo(currentRepo)
    });

    // Auto-populate first repository & file
    if (repos.length > 0) {
        await fetchFilesForRepo(repos[0])
    }
}

/**
 * Fetch the files for the chosen repository
 * @param {*} repo 
 */
async function fetchFilesForRepo(repo) {
    const response = await fetch(`/repos/${repo}/items`);
    const files = await response.json();
    updateFileList(files || []);
}

/**
 * Populates the file dropdown based on the selected repository.
 */
async function updateFileList(files) {
    const fileSelect = document.getElementById('fileSelect');

    // Populate dropdown with full relative paths for clarity
    fileSelect.innerHTML = (files)
        .map(file => `<option value="${file}">${file}</option>`)
        .join('');
}

/**
 * Fetches the selected JSON file content and commit hash via ETag.
 */
export async function fetchFile(repo, file) {
    // set the state that we are modifying this repo / file
    currentFile = file
    currentRepo = repo
    const url = `/repos/${currentRepo}/items/${currentFile}`
    const response = await fetch(url);
    const data = await response.json();
    currentHash = response.headers.get('ETag');
    // retrieve the file and format it for the textarea
    console.info(`fetching ${url}`)
    originalContent = data;
    document.getElementById('fileContent').value = JSON.stringify(originalContent, null, 2);
    document.getElementById('commitHash').innerText = currentHash;
}

/**
 * Computes JSON Patch diff and sends update request with If-Match.
 */
export async function updateFile() {
    const modifiedContent = JSON.parse(document.getElementById('fileContent').value);
    const message = document.getElementById('commitMessage').value;

    try {
        const patch = compare(originalContent, modifiedContent);

        const response = await fetch(`/repos/${currentRepo}/items/${currentFile}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'If-Match': currentHash
            },
            body: JSON.stringify({ patch, message })
        });

        if (response.status === 412) {
            alert('File has changed! No commit made.');
            return;
        }

        if (response.status === 200) {
            currentHash = response.headers.get('ETag');
            originalContent = modifiedContent;

            document.getElementById('commitHash').innerText = currentHash;
        }
    } catch (error) {
        alert('Invalid JSON format!');
    }
}

// handlers
document.getElementById('loadFileButton').addEventListener('click', async () => {
    const fileSelect = document.getElementById('fileSelect');
    currentFile = fileSelect.value;

    const repoSelect = document.getElementById('repoSelect');
    currentRepo = repoSelect.value;

    if (!currentRepo) return alert("Please select a valid repo.");
    if (!currentFile) return alert("Please select a valid file.");

    await fetchFile(currentRepo, currentFile);
});
