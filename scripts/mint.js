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

async function displayGasPrice() {
    const gasPrice = await hre.ethers.provider.getGasPrice();
    console.log(`Current gas price: ${hre.ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
}

async function displayAccountInfo(signer) {
    const address = await signer.getAddress();
    const balance = await signer.getBalance();
    console.log("\n=== Account Information ===");
    console.log(`Address: ${address}`);
    console.log(`Balance: ${hre.ethers.utils.formatEther(balance)} ETH`);
    console.log("===========================\n");
}

async function main() {
    const network = hre.network.name;
    console.log("\n======= Starting NFT Minting Process =======");
    console.log(`Network: ${network}`);
    console.log(`Timestamp: ${new Date().toLocaleString()}`);
    
    // Get contract address
    const contractAddress = config.ethereum.contracts[network === 'sepolia' ? 'testnet' : 'mainnet'];
    if (!contractAddress) {
        throw new Error(`No contract address found for ${network} network`);
    }
    console.log(`Contract Address: ${contractAddress}`);

    // Show gas price
    await displayGasPrice();

    // Get signer info
    const [signer] = await hre.ethers.getSigners();
    await displayAccountInfo(signer);

    // Connect to contract
    const MusicAlbumNFT = await hre.ethers.getContractFactory("MusicAlbumNFT");
    const musicAlbumNFT = await MusicAlbumNFT.attach(contractAddress);
    console.log("Successfully connected to MusicAlbumNFT contract");

    // Show current contract status
    const name = await musicAlbumNFT.name();
    const symbol = await musicAlbumNFT.symbol();
    const totalSupply = await musicAlbumNFT.totalSupply();
    console.log("\n=== Contract Status ===");
    console.log(`Name: ${name}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Total Supply: ${totalSupply.toString()}`);
    console.log("=====================\n");

    // Updated metadata path
    const metadataDir = path.join(__dirname, '../metadata/testnet/sepolia');
    console.log(`Looking for metadata in: ${metadataDir}`);
    
    if (!fs.existsSync(metadataDir)) {
        throw new Error(`Metadata directory not found: ${metadataDir}`);
    }

    const metadataFiles = fs.readdirSync(metadataDir).filter(file => file.endsWith('.json'));
    console.log(`Found ${metadataFiles.length} metadata file(s):`);
    metadataFiles.forEach(file => console.log(`- ${file}`));

    if (metadataFiles.length === 0) {
        throw new Error(`No metadata files found in ${metadataDir}`);
    }

    console.log('\n======= Starting NFT Minting =======');
    
    for (const file of metadataFiles) {
        console.log(`\n=== Processing ${file} ===`);
        const metadata = JSON.parse(fs.readFileSync(path.join(metadataDir, file)));
        console.log("Metadata loaded successfully");
        console.log("Song Details:");
        console.log(`- Song ID: ${metadata.songId}`);
        console.log(`- Song Name: ${metadata.songName}`);
        console.log(`- IPFS CID: ${metadata.metadata.cid}`);
        
        const minPrice = await getMinPrice(metadata.songId);
        console.log(`- Minimum Price: ${hre.ethers.utils.formatEther(minPrice)} ETH`);

        // Check if NFT is already minted
        console.log("\nChecking if NFT is already minted...");
        const totalSupply = await musicAlbumNFT.totalSupply();
        let isAlreadyMinted = false;

        for (let i = 1; i <= totalSupply; i++) {
            try {
                const existingMusic = await musicAlbumNFT.getMusicByTokenId(i);
                if (existingMusic.name === `${metadata.songId}-${metadata.songName}`) {
                    console.log(`\n⚠️ NFT already exists as Token #${i}`);
                    console.log("Details of existing token:");
                    console.log(`- Name: ${existingMusic.name}`);
                    console.log(`- URI: ${existingMusic.uri}`);
                    console.log(`- Min Price: ${hre.ethers.utils.formatEther(existingMusic.minPrice)} ETH`);
                    console.log(`- For Sale: ${existingMusic.isForSale}`);
                    console.log(`- Creator: ${existingMusic.creator}`);
                    isAlreadyMinted = true;
                    break;
                }
            } catch (error) {
                console.error(`Error checking token #${i}:`, error.message);
            }
        }

        if (!isAlreadyMinted) {
            console.log("\n🚀 Initiating minting process...");
            try {
                console.log("Preparing transaction...");
                const tx = await musicAlbumNFT.mintMusic(
                    `${metadata.songId}-${metadata.songName}`,
                    `ipfs://${metadata.metadata.cid}`,
                    minPrice
                );
                console.log(`Transaction submitted!`);
                console.log(`Transaction hash: ${tx.hash}`);
                console.log("\nWaiting for transaction confirmation...");
                
                const receipt = await tx.wait();
                console.log("\n✅ Transaction confirmed!");
                console.log("Transaction details:");
                console.log(`- Block number: ${receipt.blockNumber}`);
                console.log(`- Gas used: ${receipt.gasUsed.toString()}`);
                console.log(`- Transaction hash: ${receipt.transactionHash}`);
                
                // Get tokenId from event
                const mintEvent = receipt.events.find(e => e.event === 'MusicMinted');
                if (mintEvent) {
                    const tokenId = mintEvent.args.tokenId.toString();
                    console.log(`\n🎉 NFT successfully minted!`);
                    console.log(`Token ID: ${tokenId}`);
                    console.log(`\nView your NFT on:`);
                    console.log(`- Etherscan: ${config.ethereum.networks[network === 'sepolia' ? 'testnet' : 'mainnet'].blockExplorer}/token/${contractAddress}?a=${tokenId}`);
                    console.log(`- OpenSea: https://${network === 'sepolia' ? 'testnets.' : ''}opensea.io/assets/${network}/${contractAddress}/${tokenId}`);
                }
            } catch (error) {
                console.error(`\n❌ Error minting ${metadata.songId}:`);
                console.error(`- Error message: ${error.message}`);
                if (error.data) {
                    console.error(`- Contract error data: ${error.data}`);
                }
            }
        }
    }

    // Show final status
    console.log('\n======= Final NFT Collection Status =======');
    const finalTotalSupply = await musicAlbumNFT.totalSupply();
    console.log(`Total NFTs in collection: ${finalTotalSupply.toString()}`);
    
    for (let i = 1; i <= finalTotalSupply; i++) {
        try {
            const music = await musicAlbumNFT.getMusicByTokenId(i);
            console.log(`\nToken #${i}:`);
            console.log(`- Name: ${music.name}`);
            console.log(`- URI: ${music.uri}`);
            console.log(`- Min Price: ${hre.ethers.utils.formatEther(music.minPrice)} ETH`);
            console.log(`- For Sale: ${music.isForSale}`);
            console.log(`- Creator: ${music.creator}`);
        } catch (error) {
            console.error(`Error fetching token #${i}:`, error.message);
        }
    }

    // Show final account status
    await displayAccountInfo(signer);
    console.log("\n======= Minting Process Complete =======");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ ERROR IN MINTING PROCESS ❌");
        console.error("Error details:");
        console.error(error);
        process.exit(1);
    });
