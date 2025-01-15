require('dotenv').config();
const pinataSDK = require('@pinata/sdk');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

function initConfig() {
    console.log('\n======= Starting Upload Process =======');
    console.log('Timestamp:', new Date().toLocaleString());
    
    const configPath = path.join(__dirname, '../config.js');
    if (!fs.existsSync(configPath)) {
        console.error('❌ Configuration file not found');
        process.exit(1);
    }

    const config = require('../config');
    
    // 讀取專輯配置
    const albumsPath = path.join(__dirname, '../albums.json');
    if (!fs.existsSync(albumsPath)) {
        console.error('❌ Albums configuration file (albums.json) not found');
        process.exit(1);
    }
    const albums = require(albumsPath);
    
    if (!process.env.PINATA_API_KEY || !process.env.PINATA_SECRET_API_KEY) {
        throw new Error("❌ Please set your Pinata API credentials in the .env file");
    }

    config.pinata = {
        apiKey: process.env.PINATA_API_KEY,
        secretApiKey: process.env.PINATA_SECRET_API_KEY
    };

    return { config, albums };
}

async function uploadToIPFS(data, name, albumInfo, config) {
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
                name: `${artistInfo.prefix}${albumInfo.albumId}-${albumInfo.trackNumber}-${name}`,
                keyvalues: {
                    artist: artistInfo.name,
                    environment: config.ethereum.environment,
                    network: config.ethereum.networks[config.ethereum.environment].name,
                    albumId: albumInfo.albumId,
                    trackNumber: albumInfo.trackNumber,
                    albumName: albumInfo.albumName
                }
            }
        };

        if (typeof data === 'string') {
            const stats = fs.statSync(data);
            fileSizeInMB = stats.size / (1024 * 1024);
            const fileData = fs.createReadStream(data);
            mimeType = mime.lookup(data) || 'application/octet-stream';

            options.pinataMetadata.keyvalues.type = mimeType.includes('audio') ? 'audio' : 'image';
            options.pinataMetadata.keyvalues.mimeType = mimeType;
            
            console.log(`Uploading ${name} (${fileSizeInMB.toFixed(2)} MB)...`);
            result = await pinata.pinFileToIPFS(fileData, options);
        } else {
            options.pinataMetadata.keyvalues.type = 'metadata';
            result = await pinata.pinJSONToIPFS(data, options);
            mimeType = 'application/json';
            fileSizeInMB = Buffer.from(JSON.stringify(data)).length / (1024 * 1024);
        }

        return {
            cid: result.IpfsHash,
            mimeType: mimeType,
            size: fileSizeInMB,
            name: options.pinataMetadata.name
        };
    } catch (error) {
        console.error('Upload failed:', error);
        throw error;
    }
}

async function uploadAlbum(albumId, config, albumsConfig) {
    const albumInfo = albumsConfig[albumId];
    if (!albumInfo) {
        throw new Error(`Album ${albumId} not found in configuration`);
    }

    console.log(`\n📀 Processing album: ${albumInfo.name} (ID: ${albumId})`);
    
    const musicDir = path.join(__dirname, '../assets/music');
    const imageDir = path.join(__dirname, '../assets/images');
    
    // 驗證目錄存在
    if (!fs.existsSync(musicDir) || !fs.existsSync(imageDir)) {
        throw new Error('❌ Music or images directory not found');
    }

    // 上傳專輯封面
    console.log('\n🖼️ Uploading album cover...');
    const albumCoverPath = path.join(imageDir, albumInfo.cover);
    if (!fs.existsSync(albumCoverPath)) {
        throw new Error(`Album cover not found: ${albumInfo.cover}`);
    }
    
    const albumCover = await uploadToIPFS(albumCoverPath, 'cover', {
        albumId,
        trackNumber: '000',
        albumName: albumInfo.name
    }, config);

    const tracks = [];

    // 處理每個音軌
    for (const track of albumInfo.tracks) {
        console.log(`\n🎵 Processing track ${track.trackNumber}: ${track.name}`);
        
        // 上傳音樂檔案
        const musicPath = path.join(musicDir, track.fileName);
        if (!fs.existsSync(musicPath)) {
            console.error(`❌ Music file not found: ${track.fileName}`);
            continue;
        }

        const audioFile = await uploadToIPFS(musicPath, track.name, {
            albumId,
            trackNumber: track.trackNumber,
            albumName: albumInfo.name
        }, config);

        // 處理歌曲封面
        let trackCover = albumCover;
        if (track.cover) {
            const imagePath = path.join(imageDir, track.cover);
            if (fs.existsSync(imagePath)) {
                trackCover = await uploadToIPFS(imagePath, `${track.name}-cover`, {
                    albumId,
                    trackNumber: track.trackNumber,
                    albumName: albumInfo.name
                }, config);
            } else {
                console.warn(`⚠️ Track cover not found: ${track.cover}, using album cover instead`);
            }
        }

        // 創建 metadata
        const trackMetadata = {
            name: `${track.name}`,
            description: `Track ${track.trackNumber} from ${albumInfo.name} by ${config.project.artist.name}`,
            image: `ipfs://${trackCover.cid}`,
            animation_url: `ipfs://${audioFile.cid}`,
            attributes: [
                {
                    trait_type: "Artist",
                    value: config.project.artist.name
                },
                {
                    trait_type: "Album",
                    value: albumInfo.name
                },
                {
                    trait_type: "Track Number",
                    value: track.trackNumber
                }
            ]
        };

        // 上傳 metadata
        const metadataFile = await uploadToIPFS(
            trackMetadata,
            `${track.name}-metadata`,
            {
                albumId,
                trackNumber: track.trackNumber,
                albumName: albumInfo.name
            },
            config
        );

        tracks.push({
            trackNumber: track.trackNumber,
            trackName: track.name,
            audio: {
                file: track.fileName,
                cid: audioFile.cid
            },
            image: {
                file: track.cover || albumInfo.cover,
                cid: trackCover.cid
            },
            metadata: {
                cid: metadataFile.cid,
                content: trackMetadata
            }
        });
    }

    // 儲存結果
    const metadataDir = path.join(
        __dirname,
        '../metadata',
        'testnet',
        'sepolia'
    );
    
    if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
    }

    const results = {
        albumId: albumId,
        albumName: albumInfo.name,
        description: albumInfo.description,
        totalTracks: tracks.length,
        cover: {
            file: albumInfo.cover,
            cid: albumCover.cid
        },
        tracks: tracks
    };

    const outputPath = path.join(metadataDir, `${config.project.artist.prefix}${albumId}-${albumInfo.name}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

    console.log(`\n✨ Album ${albumInfo.name} (ID: ${albumId}) uploaded successfully!`);
    console.log(`📁 Metadata saved to: ${outputPath}`);
    return results;
}

async function uploadSingle(albumId, trackNumber, config, albumsConfig) {
    const albumInfo = albumsConfig[albumId];
    if (!albumInfo) {
        throw new Error(`Album ${albumId} not found in configuration`);
    }

    const track = albumInfo.tracks.find(t => t.trackNumber === trackNumber);
    if (!track) {
        throw new Error(`Track ${trackNumber} not found in album ${albumId}`);
    }

    console.log(`\n🎵 Uploading single track: ${track.name} (Album: ${albumInfo.name})`);
    
    // 使用與 uploadAlbum 相同的邏輯，但只處理單一歌曲
    await uploadAlbum(albumId, config, {
        [albumId]: {
            ...albumInfo,
            tracks: [track]
        }
    });
}

async function main() {
    const { config, albums } = initConfig();
    
    if (process.argv.length > 2) {
        const [albumId, trackNumber] = process.argv.slice(2);
        
        if (trackNumber) {
            console.log(`🎵 Uploading single track: Album ${albumId}, Track ${trackNumber}`);
            await uploadSingle(albumId, trackNumber, config, albums);
        } else {
            console.log(`📀 Uploading album: ${albumId}`);
            await uploadAlbum(albumId, config, albums);
        }
    } else {
        console.log('📦 Uploading all albums...');
        for (const albumId of Object.keys(albums)) {
            try {
                await uploadAlbum(albumId, config, albums);
            } catch (error) {
                console.error(`❌ Failed to upload album ${albumId}:`, error.message);
            }
        }
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { uploadToIPFS, uploadAlbum, uploadSingle };
