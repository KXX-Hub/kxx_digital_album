const hre = require("hardhat");
const fs = require('fs');
const path = require('path');
const config = require('../config');

async function getMinPrice(songId) {
    if (config.project.nft.minPrices.songs[songId]) {
        return hre.ethers.utils.parseEther(config.project.nft.minPrices.songs[songId]);
    }
    return hre.ethers.utils.parseEther(config.project.nft.minPrices.default || "0.01");
}

async function main() {
    const network = hre.network.name;
    console.log(`\n🚀 Deploying to ${network}...`);

    // Deploy contract
    const MusicAlbumNFT = await hre.ethers.getContractFactory("MusicAlbumNFT");
    console.log("📄 Deploying MusicAlbumNFT...");
    const musicAlbumNFT = await MusicAlbumNFT.deploy();
    await musicAlbumNFT.deployed();
    console.log(`✅ MusicAlbumNFT deployed to: ${musicAlbumNFT.address}`);

    // Update config with the new contract address
    const configPath = path.join(__dirname, '../config.js');
    const updatedConfig = { ...config };
    
    if (network === 'sepolia') {
        updatedConfig.ethereum.contracts = {
            ...updatedConfig.ethereum.contracts,
            testnet: musicAlbumNFT.address
        };
    } else if (network === 'mainnet') {
        updatedConfig.ethereum.contracts = {
            ...updatedConfig.ethereum.contracts,
            mainnet: musicAlbumNFT.address
        };
    }

    // Write the updated config back to the file
    const configContent = `require('dotenv').config();\n\nmodule.exports = ${JSON.stringify(updatedConfig, null, 2)};`;
    fs.writeFileSync(configPath, configContent);
    console.log('📝 Updated config.js with new contract address');

    // Wait for block confirmations
    console.log('⏳ Waiting for block confirmations...');
    await musicAlbumNFT.deployTransaction.wait(5);

    // Verify contract
    if (process.env.ETHERSCAN_API_KEY) {
        console.log('🔍 Verifying contract on Etherscan...');
        try {
            await hre.run("verify:verify", {
                address: musicAlbumNFT.address,
                constructorArguments: [],
            });
            console.log("✅ Contract verified on Etherscan");
        } catch (error) {
            console.log("❌ Error verifying contract:", error.message);
        }
    }

    // Mint NFTs
    const metadataDir = path.join(__dirname, '../metadata', network);
    if (fs.existsSync(metadataDir)) {
        const metadataFiles = fs.readdirSync(metadataDir).filter(file => file.endsWith('.json'));
        
        if (metadataFiles.length > 0) {
            console.log('\n🎨 Minting initial NFTs...');
            
            for (const file of metadataFiles) {
                const metadata = JSON.parse(fs.readFileSync(path.join(metadataDir, file)));
                const minPrice = await getMinPrice(metadata.songId);

                console.log(`\n📝 Minting ${metadata.songId}...`);
                console.log(`Name: ${metadata.songName}`);
                console.log(`Metadata URI: ipfs://${metadata.metadata.cid}`);
                console.log(`Minimum Price: ${hre.ethers.utils.formatEther(minPrice)} ETH`);
                console.log(`Creator Royalty: 10%`);
                
                try {
                    const tx = await musicAlbumNFT.mintMusic(
                        `${metadata.songId}-${metadata.songName}`,
                        `ipfs://${metadata.metadata.cid}`,
                        minPrice
                    );
                    const receipt = await tx.wait();
                    const event = receipt.events?.find(e => e.event === 'MusicMinted');
                    const tokenId = event?.args?.tokenId.toString();

                    console.log(`✅ Successfully minted ${metadata.songId}`);
                    console.log(`Token ID: ${tokenId}`);
                    console.log(`Transaction hash: ${receipt.transactionHash}`);
                    
                    if (tokenId) {
                        console.log(`🔗 View on OpenSea: https://${network === 'sepolia' ? 'testnets.' : ''}opensea.io/assets/${network}/${musicAlbumNFT.address}/${tokenId}`);
                    }
                } catch (error) {
                    console.error(`❌ Error minting ${metadata.songId}:`, error.message);
                }
            }
        }
    } else {
        console.log(`\n⚠️ No metadata directory found at: ${metadataDir}`);
    }

    // Display summary
    console.log("\n✨ Deployment and minting complete!");
    console.log("📄 Contract address:", musicAlbumNFT.address);
    console.log(`🔍 View on ${config.ethereum.networks[network === 'sepolia' ? 'testnet' : 'mainnet'].blockExplorer}/address/${musicAlbumNFT.address}`);
    
    // Save deployment info
    const deploymentInfo = {
        network,
        contractAddress: musicAlbumNFT.address,
        deploymentTime: new Date().toISOString(),
        blockNumber: await hre.ethers.provider.getBlockNumber(),
    };

    const deploymentDir = path.join(__dirname, '../deployments');
    if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir);
    }

    fs.writeFileSync(
        path.join(deploymentDir, `${network}-${deploymentInfo.deploymentTime.split('T')[0]}.json`),
        JSON.stringify(deploymentInfo, null, 2)
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Deployment failed:', error);
        process.exit(1);
    });
