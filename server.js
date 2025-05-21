import express from 'express';
import fs from 'fs/promises';
import simpleGit from 'simple-git';
import path from 'path';
import { fileURLToPath } from 'url';
import { applyPatch } from 'fast-json-patch';
import cors from 'cors';

const app = express();

app.use(cors({
    exposedHeaders: ['ETag']
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_REPO_PATH = path.join(__dirname, 'repos'); // Update this to your actual repository directory

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Storage for repositories
const repositories = {};

/**
 * Recursively retrieves all JSON files inside a repository.
 */
async function getJsonFiles(dirPath, basePath) {
    let files = [];
    try {
        const items = await fs.readdir(dirPath, { withFileTypes: true });

        for (const item of items) {
            const fullPath = path.join(dirPath, item.name);
            if (item.isDirectory()) {
                // Recursively scan subdirectories
                files.push(...await getJsonFiles(fullPath, basePath));
            } else if (item.name.endsWith('.json')) {
                // Store full relative path
                files.push(path.relative(basePath, fullPath));
            }
        }
    } catch (error) {
        console.error(`Error scanning directory: ${dirPath}`, error);
    }
    return files;
}

/**
 * Scans all repositories and retrieves JSON files recursively.
 */
async function scanRepositories() {
    try {
        const repoFolders = await fs.readdir(BASE_REPO_PATH, { withFileTypes: true });
        for (const repoName of repoFolders) {
            if (repoName.isDirectory()) {
                const repoPath = path.join(BASE_REPO_PATH, repoName.name);
                repositories[repoName.name] = {
                    path: repoPath,
                    git: simpleGit(repoPath),
                    files: await getJsonFiles(repoPath, repoPath) // Ensure full relative paths
                };
            }
        }
    } catch (error) {
        console.error('Error scanning repositories:', error);
    }
}

scanRepositories();

// GET: List available repositories & JSON files
app.get('/repos', (req, res) => {
    const repos = Object.keys(repositories) // .map((repoName, repoData) => repoName)
    console.log(repos)
    res.json(repos)
    // const sanitizedRepos = Object.entries(repositories).reduce((acc, [repoName, repoData]) => {
    //     repoName
    //     // acc[repoName] = repoData.files
    //     // {
    //     //     path: repoData.path,
    //     //     files: repoData.files // Exclude `git` object to prevent circular references
    //     // };
    //     return acc;
    // }, {});

    // res.json(sanitizedRepos);
});


app.get('/', (req, res) => {
    const repos = Object.keys(repositories) // .map((repoName, repoData) => repoName)
    console.log(repos)
    res.writeHead(200, { 'Content-Type': 'text/html' })
    // const out = Object.keys(repositories).map((r) => `repos/${r}/repositories[r].files)

    let out = []
    for (const repo of Object.keys(repositories)) {
        console.log(repo)
        for (const fileName of repositories[repo].files) {
            let href = `./repos/${repo}/items/${fileName}`
            out.push(`<li><a href="${href}">${href}</a>`)
        }
    }
    res.write(`<!doctype html><html><ul>${out.join("\n")}</ul></html>`)
    res.end()
    // const sanitizedRepos = Object.entries(repositories).reduce((acc, [repoName, repoData]) => {
    //     repoName
    //     // acc[repoName] = repoData.files
    //     // {
    //     //     path: repoData.path,
    //     //     files: repoData.files // Exclude `git` object to prevent circular references
    //     // };
    //     return acc;
    // }, {});

    // res.json(sanitizedRepos);
});


app.get('/repos/:repo/items/', async (req, res) => {
    let { repo } = req.params;
    if (!repositories[repo]) {
        return res.status(404).send('File not found');
    }
    res.json(repositories[repo].files)
})

// GET: Fetch file content & send ETag
app.get('/repos/:repo/items/{*filename}', async (req, res) => {
    let { repo, filename } = req.params;
    // const filename = req.params[0]; // Capture the full relative file path
    console.log(filename)
    filename = filename.join("/")
    if (!repositories[repo] || !repositories[repo].files.includes(filename)) {
        return res.status(404).send('File not found');
    }

    const filePath = path.join(repositories[repo].path, filename);
    try {
        //        const content = await fs.readFile(filePath, 'utf-8');
        const log = await repositories[repo].git.log({ maxCount: 1 });
        const commitHash = log.latest?.hash || 'No commit found';

        res.set('ETag', commitHash);
        console.log(`sending ${commitHash}`)
        //        res.json(content);
        //        console.log(content)
        res.sendFile(filePath);
    } catch (error) {
        res.status(500).send('Error fetching file');
    }
});

// PATCH: Apply JSON Patch only if ETag matches
app.patch('/repos/:repo/items/{*filename}', async (req, res) => {
    let { repo, filename } = req.params;
    // const filename = req.params[0]; // Capture full relative file path
    const { patch, message } = req.body;
    const clientETag = req.headers['if-match'];

    filename = filename.join("/")
    if (!repositories[repo] || !repositories[repo].files.includes(filename)) {
        return res.status(404).send('File not found');
    }
    if (!patch || !message || !clientETag) {
        return res.status(400).send('Patch, commit message, and If-Match header required');
    }

    const filePath = path.join(repositories[repo].path, filename);
    try {
        let oldContent = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        const log = await repositories[repo].git.log({ maxCount: 1 });
        const latestHash = log.latest?.hash || 'No commit found';

        if (clientETag !== latestHash) {
            return res.status(412).send({ status: 'precondition failed', latestHash });
        }

        let newContent = applyPatch(oldContent, patch).newDocument;
        await fs.writeFile(filePath, JSON.stringify(newContent, null, 2), 'utf-8');
        await repositories[repo].git.add(filePath).commit(message);

        const updatedLog = await repositories[repo].git.log({ maxCount: 1 });
        const updatedHash = updatedLog.latest?.hash || 'No commit found';

        res.set('ETag', updatedHash);
        res.status(200).send({ status: 'success' });
    } catch (error) {
        res.status(500).send('Error committing file');
    }
});

// Start the server
const PORT = 3000;
const server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} is already in use. Server process stopped.`);
    } else {
        console.error(err)
    }
});
