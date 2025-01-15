require('dotenv').config();
const pinataSDK = require('@pinata/sdk');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

// Configuration check and creation
function initConfig() {
    console.log('\n======= Starting Upload Process =======');
    console.log('Timestamp:', new Date().toLocaleString());
    
    const configPath = path.join(__dirname, '../config.js');
    console.log('Looking for config file at:', configPath);

    // Check if config file exists
    if (!fs.existsSync(configPath)) {
        console.error('❌ Configuration file not found at:', configPath);
        process.exit(1);
    }

    // Load configuration
    const config = require('../config');

    // Debug logging for configuration
    console.log('\n=== Environment Check ===');
    console.log('PINATA_API_KEY exists:', !!process.env.PINATA_API_KEY ? '✅' : '❌');
    console.log('PINATA_SECRET_API_KEY exists:', !!process.env.PINATA_SECRET_API_KEY ? '✅' : '❌');
    
    console.log('\n=== Config Check ===');
    console.log('Pinata config:', {
        apiKey: config.pinata.apiKey ? '✅' : '❌',
        secretApiKey: config.pinata.secretApiKey ? '✅' : '❌'
    });

    // Check required configuration items
    if (!process.env.PINATA_API_KEY || !process.env.PINATA_SECRET_API_KEY) {
        throw new Error("❌ Please set your Pinata API credentials in the .env file");
    }

    // Override config with environment variables
    config.pinata = {
        apiKey: process.env.PINATA_API_KEY,
        secretApiKey: process.env.PINATA_SECRET_API_KEY
    };

    console.log('\n=== Project Configuration ===');
    console.log(`Environment: ${config.ethereum.environment}`);
    console.log(`Network: ${config.ethereum.networks[config.ethereum.environment].name}`);
    console.log('=============================\n');

    return config;
}

async function uploadToIPFS(data, name, songId, config) {
    const artistInfo = config.project.artist;
    const pinata = new pinataSDK(
        config.pinata.apiKey,
        config.pinata.secretApiKey
    );

    try {
        let result;
        let mimeType;
        let fileSizeInMB;

        const options = {
            pinataMetadata: {
                name: `${artistInfo.prefix}${songId.padStart(3, '0')}-${name}`,
                keyvalues: {
                    artist: artistInfo.name,
                    environment: config.ethereum.environment,
                    network: config.ethereum.networks[config.ethereum.environment].name,
                    songId: `${artistInfo.prefix}${songId.padStart(3, '0')}`
                }
            }
        };

        if (typeof data === 'string') {
            const stats = fs.statSync(data);
            fileSizeInMB = stats.size / (1024 * 1024);
            console.log(`File size: ${fileSizeInMB.toFixed(2)} MB`);
            
            const fileData = fs.createReadStream(data);
            mimeType = mime.lookup(data) || 'application/octet-stream';

            options.pinataMetadata.keyvalues.type = mimeType.includes('audio') ? 'audio' : 'image';
            options.pinataMetadata.keyvalues.mimeType = mimeType;
            options.pinataMetadata.keyvalues.size = `${fileSizeInMB.toFixed(2)}MB`;

            console.log(`Starting upload for ${options.pinataMetadata.name}...`);
            result = await pinata.pinFileToIPFS(fileData, options);
        } else {
            console.log(`Starting metadata upload for ${options.pinataMetadata.name}...`);
            options.pinataMetadata.keyvalues.type = 'metadata';
            result = await pinata.pinJSONToIPFS(data, options);
            mimeType = 'application/json';
            fileSizeInMB = Buffer.from(JSON.stringify(data)).length / (1024 * 1024);
        }

        console.log(`✅ Successfully uploaded ${options.pinataMetadata.name}, CID: ${result.IpfsHash}`);
        
        return {
            cid: result.IpfsHash,
            mimeType: mimeType,
            size: fileSizeInMB,
            name: options.pinataMetadata.name
        };
    } catch (error) {
        if (error.message.includes("INVALID_API_KEYS")) {
            console.error('\x1b[31m%s\x1b[0m', [
                '',
                'Error: Invalid Pinata API Keys',
                'Please ensure you have set the correct API keys in the .env file',
                'You can get your keys from https://app.pinata.cloud/',
                ''
            ].join('\n'));
        } else {
            console.error(`Upload failed:`, error);
        }
        throw error;
    }
}

async function uploadSingle(songFullName, config) {
    const artistInfo = config.project.artist;
    const songId = songFullName.split('-')[0].replace(artistInfo.prefix, '');
    const songName = songFullName.split('-')[1];

    const musicPath = path.join(__dirname, `../assets/music/${songFullName}.mp3`);
    const imagePath = path.join(__dirname, `../assets/images/${songFullName}.jpg`);

    if (!fs.existsSync(musicPath) || !fs.existsSync(imagePath)) {
        throw new Error(`❌ Files not found for ${songFullName}`);
    }

    return await processUpload(musicPath, imagePath, songId, songName, config);
}

async function uploadAll(config) {
    const musicDir = path.join(__dirname, '../assets/music');
    const imageDir = path.join(__dirname, '../assets/images');

    if (!fs.existsSync(musicDir) || !fs.existsSync(imageDir)) {
        throw new Error('❌ Music or images directory not found');
    }

    const musicFiles = fs.readdirSync(musicDir)
        .filter(file => file.endsWith('.mp3'))
        .map(file => path.parse(file).name);

    console.log('\n📝 Found music files:', musicFiles);

    for (const fullName of musicFiles) {
        const artistInfo = config.project.artist;
        const songId = fullName.split('-')[0].replace(artistInfo.prefix, '');
        const songName = fullName.split('-')[1];

        const musicPath = path.join(musicDir, `${fullName}.mp3`);
        const imagePath = path.join(imageDir, `${fullName}.jpg`);

        if (!fs.existsSync(imagePath)) {
            console.warn(`⚠️ Warning: Image not found for ${fullName}, skipping...`);
            continue;
        }

        console.log(`\n🎵 Processing ${fullName}...`);
        await processUpload(musicPath, imagePath, songId, songName, config);
    }
}

async function processUpload(musicPath, imagePath, songId, songName, config) {
    try {
        const metadataDir = path.join(__dirname, '../metadata', config.ethereum.environment);
        if (!fs.existsSync(metadataDir)) {
            fs.mkdirSync(metadataDir, { recursive: true });
        }

        console.log(`📤 Uploading files for ${songId}-${songName}...`);
        const audioFile = await uploadToIPFS(musicPath, songName, songId, config);
        const imageFile = await uploadToIPFS(imagePath, `${songName}-Cover`, songId, config);

        const metadata = {
            name: `${config.project.artist.prefix}${songId.padStart(3, '0')}-${songName}`,
            description: `${songName} by ${config.project.artist.name}`,
            image: `ipfs://${imageFile.cid}`,
            animation_url: `ipfs://${audioFile.cid}`,
            attributes: [
                {
                    trait_type: "Artist",
                    value: config.project.artist.name
                },
                {
                    trait_type: "Song ID",
                    value: `${config.project.artist.prefix}${songId.padStart(3, '0')}`
                },
                {
                    trait_type: "Environment",
                    value: config.ethereum.environment
                },
                {
                    trait_type: "Network",
                    value: config.ethereum.networks[config.ethereum.environment].name
                }
            ],
            properties: {
                files: [
                    {
                        uri: `ipfs://${audioFile.cid}`,
                        type: "audio"
                    },
                    {
                        uri: `ipfs://${imageFile.cid}`,
                        type: "image"
                    }
                ],
                category: "music",
                artist: config.project.artist.name,
                environment: config.ethereum.environment,
                network: config.ethereum.networks[config.ethereum.environment].name
            }
        };

        const metadataFile = await uploadToIPFS(metadata, `${songName}-Metadata`, songId, config);

        const results = {
            environment: config.ethereum.environment,
            network: config.ethereum.networks[config.ethereum.environment].name,
            songId: `${config.project.artist.prefix}${songId.padStart(3, '0')}`,
            songName: songName,
            audio: {
                file: path.basename(musicPath),
                cid: audioFile.cid,
                size: audioFile.size
            },
            image: {
                file: path.basename(imagePath),
                cid: imageFile.cid,
                size: imageFile.size
            },
            metadata: {
                cid: metadataFile.cid,
                content: metadata
            }
        };

        fs.writeFileSync(
            path.join(metadataDir, `${config.project.artist.prefix}${songId}-${songName}.json`),
            JSON.stringify(results, null, 2)
        );

        console.log(`✨ Upload completed for ${songId}-${songName}`);
        return results;
    } catch (error) {
        console.error(`❌ Error processing ${songId}-${songName}:`, error);
        throw error;
    }
}

async function main() {
    const config = initConfig();
    
    if (process.argv.length > 2) {
        const songFullName = process.argv[2];
        console.log(`🎵 Uploading single song: ${songFullName}`);
        await uploadSingle(songFullName, config);
    } else {
        console.log('📦 Uploading all songs...');
        await uploadAll(config);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { uploadToIPFS, uploadSingle, uploadAll };
