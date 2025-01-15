const hre = require("hardhat");
const fs = require('fs');
const path = require('path');
const config = require('../config');

async function getMinPrice(songId) {
    // 檢查是否有特定歌曲的最低價格設定
    if (config.project.nft.minPrices.songs[songId]) {
        return hre.ethers.utils.parseEther(config.project.nft.minPrices.songs[songId]);
    }
    // 否則使用默認最低價格
    return hre.ethers.utils.parseEther(config.project.nft.minPrices.default || "0.01");
}

async function main() {
    const network = hre.network.name;
    console.log(`🌐 Connected to ${network}...`);

    // 獲取合約地址
    const contractAddress = config.ethereum.contracts[network === 'sepolia' ? 'testnet' : 'mainnet'];
    if (!contractAddress) {
        throw new Error(`❌ No contract address found for ${network} network`);
    }

    // 連接到合約
    const MusicAlbumNFT = await hre.ethers.getContractFactory("MusicAlbumNFT");
    const musicAlbumNFT = await MusicAlbumNFT.attach(contractAddress);
    console.log(`📄 Connected to MusicAlbumNFT at: ${contractAddress}`);

    // 讀取要鑄造的NFT資訊
    const metadataDir = path.join(__dirname, '../metadata', 'testnet', 'sepolia');
    if (!fs.existsSync(metadataDir)) {
        throw new Error(`❌ Metadata directory not found: ${metadataDir}`);
    }

    const metadataFiles = fs.readdirSync(metadataDir).filter(file => file.endsWith('.json'));
    if (metadataFiles.length === 0) {
        throw new Error(`❌ No metadata files found in ${metadataDir}`);
    }

    console.log('\n🔨 Preparing to mint NFTs...');
    
    for (const file of metadataFiles) {
        const metadata = JSON.parse(fs.readFileSync(path.join(metadataDir, file)));
        const minPrice = await getMinPrice(metadata.songId);

        // 檢查NFT是否已經被鑄造
        const totalSupply = await musicAlbumNFT.totalSupply();
        let isAlreadyMinted = false;

        for (let i = 1; i <= totalSupply; i++) {
            try {
                const existingMusic = await musicAlbumNFT.getMusicByTokenId(i);
                if (existingMusic.name === `${metadata.songId}-${metadata.songName}`) {
                    console.log(`\n⏭️ Skipping ${metadata.songId} - Already minted as token #${i}`);
                    isAlreadyMinted = true;
                    break;
                }
            } catch (error) {
                console.error(`❌ Error checking token #${i}:`, error.message);
            }
        }

        if (!isAlreadyMinted) {
            console.log(`\n📝 Minting ${metadata.songId}...`);
            console.log(`Name: ${metadata.songName}`);
            console.log(`Metadata URI: ipfs://${metadata.metadata.cid}`);
            console.log(`Minimum Price: ${hre.ethers.utils.formatEther(minPrice)} ETH`);
            
            try {
                const tx = await musicAlbumNFT.mintMusic(
                    `${metadata.songId}-${metadata.songName}`,
                    `ipfs://${metadata.metadata.cid}`,
                    minPrice
                );
                console.log(`🔄 Transaction submitted: ${tx.hash}`);
                
                const receipt = await tx.wait();
                console.log(`✨ Successfully minted ${metadata.songId}`);
                console.log(`Transaction hash: ${receipt.transactionHash}`);
                console.log(`Gas used: ${receipt.gasUsed.toString()}`);
                
                // 從事件中獲取tokenId
                const mintEvent = receipt.events.find(e => e.event === 'MusicMinted');
                if (mintEvent) {
                    const tokenId = mintEvent.args.tokenId.toString();
                    console.log(`Token ID: ${tokenId}`);
                    console.log(`🔍 View on OpenSea: https://${network === 'sepolia' ? 'testnets.' : ''}opensea.io/assets/${network}/${contractAddress}/${tokenId}`);
                }
            } catch (error) {
                console.error(`❌ Error minting ${metadata.songId}:`, error.message);
            }
        }
    }

    // 顯示所有已鑄造的NFT
    console.log('\n📊 Current NFT collection status:');
    const totalSupply = await musicAlbumNFT.totalSupply();
    console.log(`Total NFTs minted: ${totalSupply.toString()}`);
    
    for (let i = 1; i <= totalSupply; i++) {
        try {
            const music = await musicAlbumNFT.getMusicByTokenId(i);
            console.log(`\n🎵 Token #${i}:`);
            console.log(`Name: ${music.name}`);
            console.log(`URI: ${music.uri}`);
            console.log(`Min Price: ${hre.ethers.utils.formatEther(music.minPrice)} ETH`);
            console.log(`For Sale: ${music.isForSale ? '✅' : '❌'}`);
            console.log(`Creator: ${music.creator}`);
        } catch (error) {
            console.error(`❌ Error fetching token #${i}:`, error.message);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
