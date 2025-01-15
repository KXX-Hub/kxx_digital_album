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
    return hre.ethers.utils.parseEther(config.project.nft.minPrices.default || "0.01"); // 默認最低價格 0.01 ETH
}

async function main() {
    const network = hre.network.name;
    console.log(`🚀 Deploying to ${network}...`);

    const MusicAlbumNFT = await hre.ethers.getContractFactory("MusicAlbumNFT");
    console.log("📄 Deploying MusicAlbumNFT...");

    const musicAlbumNFT = await MusicAlbumNFT.deploy();
    await musicAlbumNFT.deployed();

    console.log(` ✅ MusicAlbumNFT deployed to: ${musicAlbumNFT.address}`);

    // 更新配置文件中的合約地址
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

    // 等待區塊確認
    console.log('⏳ Waiting for block confirmations...');
    await musicAlbumNFT.deployTransaction.wait(5);

    // 驗證合約
    if (process.env.ETHERSCAN_API_KEY) {
        console.log(' 🔍 Verifying contract on Etherscan...');
        try {
            await hre.run("verify:verify", {
                address: musicAlbumNFT.address,
                constructorArguments: [],
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

    // 鑄造 NFT
    const metadataDir = path.join(__dirname, '../metadata', network === 'sepolia' ? 'testnet/sepolia' : 'mainnet');
    
    if (!fs.existsSync(metadataDir)) {
        console.warn(`⚠️ No metadata directory found at: ${metadataDir}`);
    } else {
        const metadataFiles = fs.readdirSync(metadataDir).filter(file => file.endsWith('.json'));
        
        if (metadataFiles.length > 0) {
            console.log('\n🔨 Minting initial NFTs...');
            
            for (const file of metadataFiles) {
                const metadata = JSON.parse(fs.readFileSync(path.join(metadataDir, file)));
                const minPrice = await getMinPrice(metadata.songId);

                console.log(`\n📝 Minting ${metadata.songId}...`);
                console.log(`Name: ${metadata.songName}`);
                console.log(`Metadata URI: ipfs://${metadata.metadata.cid}`);
                console.log(`Minimum Price: ${hre.ethers.utils.formatEther(minPrice)} ETH`);
                
                try {
                    const tx = await musicAlbumNFT.mintMusic(
                        metadata.songId + "-" + metadata.songName,
                        `ipfs://${metadata.metadata.cid}`,
                        minPrice
                    );
                    const receipt = await tx.wait();
                    console.log(`✨ Successfully minted ${metadata.songId}`);
                    console.log(`Transaction hash: ${receipt.transactionHash}`);

                    // 從事件中獲取 tokenId
                    const mintEvent = receipt.events.find(e => e.event === 'MusicMinted');
                    if (mintEvent) {
                        const tokenId = mintEvent.args.tokenId.toString();
                        console.log(`Token ID: ${tokenId}`);
                        console.log(`🔍 View on OpenSea: https://${network === 'sepolia' ? 'testnets.' : ''}opensea.io/assets/${network}/${musicAlbumNFT.address}/${tokenId}`);
                    }
                } catch (error) {
                    console.error(`❌ Error minting ${metadata.songId}:`, error.message);
                }
            }
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
