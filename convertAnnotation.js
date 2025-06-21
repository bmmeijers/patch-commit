
import { readFile, writeFile } from 'fs/promises'
import { generateAnnotation, parseAnnotation } from '@allmaps/annotation'

// Reads a (possibly before spec) annotation, 
// outputting it using the latest
// georeference annotation serialization format

const [, , filePath] = process.argv

if (!filePath) {
    console.error('Usage: bun convertAnnotation.js <path-to-json-file>')
    process.exit(1)
}

async function processFile(path) {
    try {
        const content = await readFile(path, 'utf-8')
        const json = JSON.parse(content)
        const parsed = parseAnnotation(json)
        const generated = generateAnnotation(parsed)
        await writeFile(path, JSON.stringify(generated, null, 2))
        // console.log(`File "${path}" successfully updated.`)
    } catch (err) {
        console.error('Error processing file:', err)
    }
}

processFile(filePath)
