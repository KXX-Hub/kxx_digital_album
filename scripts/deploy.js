const hre = require("hardhat");
const fs = require('fs');
const path = require('path');
const config = require('../config');

async function main() {
    const network = hre.network.name;
    console.log(`🚀 Deploying to ${network}...`);

    const MusicAlbumNFT = await hre.ethers.getContractFactory("MusicAlbumNFT");
    console.log("📄 Deploying MusicAlbumNFT...");

    const royaltyCreator = config.project.nft.royalty.creator;
    const royaltySeller = config.project.nft.royalty.seller;

    const musicAlbumNFT = await MusicAlbumNFT.deploy(royaltyCreator, royaltySeller);
    await musicAlbumNFT.deployed();

    console.log(`✅ MusicAlbumNFT deployed to: ${musicAlbumNFT.address}`);

    // 更新合約地址
    const addressesPath = path.join(__dirname, '../deployedAddresses.json');
    const addresses = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));
    
    if (network === 'sepolia') {
        addresses.testnet = musicAlbumNFT.address;
    } else if (network === 'mainnet') {
        addresses.mainnet = musicAlbumNFT.address;
    }

    fs.writeFileSync(
        addressesPath,
        JSON.stringify(addresses, null, 4)
    );
    console.log('📝 Updated deployedAddresses.json with new contract address');

    console.log('⏳ Waiting for block confirmations...');
    await musicAlbumNFT.deployTransaction.wait(5);

    if (process.env.ETHERSCAN_API_KEY) {
        console.log('🔍 Verifying contract on Etherscan...');
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

    console.log("\n✨ Deployment complete!");
    console.log("📄 Contract address:", musicAlbumNFT.address);
    console.log(`🔍 View on ${config.ethereum.networks[network === 'sepolia' ? 'testnet' : 'mainnet'].blockExplorer}/address/${musicAlbumNFT.address}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
