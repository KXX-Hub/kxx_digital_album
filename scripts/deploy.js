const hre = require("hardhat");
const fs = require('fs');
const path = require('path');
const config = require('../config');

async function getMinPrice(albumId) {
    if (config.project.nft.minPrices.songs[albumId]) {
        return hre.ethers.utils.parseEther(config.project.nft.minPrices.songs[albumId]);
    }
    return hre.ethers.utils.parseEther(config.project.nft.minPrices.default || "0.01");
}

async function main() {
    const network = hre.network.name;
    console.log(`🚀 Deploying to ${network}...`);

    const MusicAlbumNFT = await hre.ethers.getContractFactory("MusicAlbumNFT");
    console.log("📄 Deploying MusicAlbumNFT...");

    const royaltyCreator = config.project.nft.royalty.creator;
    const royaltySeller = config.project.nft.royalty.seller;

    const musicAlbumNFT = await MusicAlbumNFT.deploy(royaltyCreator, royaltySeller);
    await musicAlbumNFT.deployed();

    console.log(` ✅ MusicAlbumNFT deployed to: ${musicAlbumNFT.address}`);

    if (network === 'sepolia') {
        config.ethereum.contracts.testnet = musicAlbumNFT.address;
    } else if (network === 'mainnet') {
        config.ethereum.contracts.mainnet = musicAlbumNFT.address;
    }

    fs.writeFileSync(
        path.join(__dirname, '../config.js'),
        `module.exports = ${JSON.stringify(config, null, 4)};`
    );
    console.log('📝 Updated config.js with new contract address');

    console.log('⏳ Waiting for block confirmations...');
    await musicAlbumNFT.deployTransaction.wait(5);

    if (process.env.ETHERSCAN_API_KEY) {
        console.log(' 🔍 Verifying contract on Etherscan...');
        try {
            await hre.run("verify:verify", {
                address: musicAlbumNFT.address,
                constructorArguments: [royaltyCreator, royaltySeller],
            });
            console.log("✅ Contract verified on Etherscan");
        } catch (error) {
            if (error.message.includes("already verified")) {
                console.log("Contract has already been verified");
            } else {
                console.log("❌ Error verifying contract:", error.message);
            }
        }
    }

    const albumsPath = path.join(__dirname, '../albums.json');
    if (!fs.existsSync(albumsPath)) {
        console.warn('⚠️ No albums.json found');
        return;
    }

    const albums = JSON.parse(fs.readFileSync(albumsPath, 'utf8'));

    for (const [albumId, albumInfo] of Object.entries(albums)) {
        console.log(`\n📀 Processing album: ${albumInfo.name} (ID: ${albumId})`);

        try {
            const numericAlbumId = parseInt(albumId);
            
            console.log(`Creating album: ${albumInfo.name}`);
            const createAlbumTx = await musicAlbumNFT.createAlbum(
                albumInfo.name,
                albumInfo.cover,
                albumInfo.tracks.length,
                albumInfo.maxSupply || 1000
            );
            await createAlbumTx.wait();

            let metadataPath = path.join(
                __dirname,
                '../metadata',
                'testnet',
                'sepolia',
                `K${albumId}-${albumInfo.name}.json`  // 直接使用 K 前綴
            );

            console.log(`Looking for metadata at: ${metadataPath}`);

            if (!fs.existsSync(metadataPath)) {
                console.warn(`⚠️ Metadata not found at ${metadataPath}`);
                console.log('Trying alternative path...');
                
                // 嘗試其他可能的路徑
                const alternativePath = path.join(
                    __dirname,
                    '../metadata',
                    'testnet',
                    'sepolia',
                    `${config.project.artist.prefix}${String(albumId).padStart(3, '0')}-${albumInfo.name}.json`
                );
                
                console.log(`Trying alternative path: ${alternativePath}`);
                
                if (!fs.existsSync(alternativePath)) {
                    console.warn(`⚠️ Metadata also not found at alternative path`);
                    continue;
                }
                
                console.log('✅ Found metadata at alternative path');
                metadataPath = alternativePath;
            }

            const metadata = JSON.parse(fs.readFileSync(metadataPath));

            for (const track of metadata.tracks) {
                const minPrice = await getMinPrice(albumId);
                const trackNumber = parseInt(track.trackNumber);
                
                console.log(`\n🎵 Minting track ${track.trackNumber}: ${track.trackName}`);
                console.log(`Metadata URI: ipfs://${track.metadata.cid}`);
                console.log(`Minimum Price: ${hre.ethers.utils.formatEther(minPrice)} ETH`);

                try {
                    const trackConfig = albumInfo.tracks.find(t => parseInt(t.trackNumber) === trackNumber);
                    const maxSupply = trackConfig?.maxSupply || 100;

                    const tx = await musicAlbumNFT.mintTrack(
                        numericAlbumId,
                        trackNumber,
                        track.trackName,
                        `ipfs://${track.metadata.cid}`,
                        minPrice,
                        maxSupply
                    );

                    const receipt = await tx.wait();
                    console.log(`✨ Successfully minted track ${track.trackNumber}`);
                    console.log(`Transaction hash: ${receipt.transactionHash}`);

                    const mintEvent = receipt.events.find(e => e.event === 'TrackMinted');
                    if (mintEvent) {
                        const tokenId = mintEvent.args.tokenId.toString();
                        console.log(`Token ID: ${tokenId}`);
                        console.log(`🔍 View on OpenSea: https://${network === 'sepolia' ? 'testnets.' : ''}opensea.io/assets/${network}/${musicAlbumNFT.address}/${tokenId}`);
                    }
                } catch (error) {
                    console.error(`❌ Error minting track ${track.trackNumber}:`, error.message);
                }
            }
        } catch (error) {
            console.error(`❌ Error processing album ${albumId}:`, error.message);
            console.error(error);
        }
    }

    console.log("\n✨ Deployment and minting complete!");
    console.log("📄 Contract address:", musicAlbumNFT.address);
    console.log(`🔍 View on ${config.ethereum.networks[network === 'sepolia' ? 'testnet' : 'mainnet'].blockExplorer}/address/${musicAlbumNFT.address}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
