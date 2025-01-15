// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract MusicAlbumNFT is ERC721, Ownable, ReentrancyGuard {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    // Music struct
    struct Music {
        string name;
        string uri;
        uint256 minPrice; // 最低價格
        bool isForSale;
        address creator; // 創作者地址
    }

    // Mapping from tokenId to Music
    mapping(uint256 => Music) public musicCollection;

    // Events
    event MusicMinted(uint256 indexed tokenId, string name, address owner);
    event MusicMinPriceUpdated(uint256 indexed tokenId, uint256 newMinPrice);
    event MusicSaleStatusUpdated(uint256 indexed tokenId, bool isForSale);
    event MusicPurchased(uint256 indexed tokenId, address buyer, uint256 price);

    constructor() ERC721("KXX Digital Album", "KXXM") {}

    // Check if tokenId exists
    function exists(uint256 tokenId) public view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    // Mint new music NFT
    function mintMusic(
        string memory name,
        string memory uri,
        uint256 minPrice
    ) public onlyOwner returns (uint256) {
        _tokenIds.increment();
        uint256 newTokenId = _tokenIds.current();

        _safeMint(msg.sender, newTokenId);

        musicCollection[newTokenId] = Music({
            name: name,
            uri: uri,
            minPrice: minPrice,
            isForSale: true,
            creator: msg.sender
        });

        emit MusicMinted(newTokenId, name, msg.sender);
        return newTokenId;
    }

    // Update minimum price
    function updateMinPrice(
        uint256 tokenId,
        uint256 newMinPrice
    ) public onlyOwner {
        require(exists(tokenId), "Music does not exist");
        musicCollection[tokenId].minPrice = newMinPrice;
        emit MusicMinPriceUpdated(tokenId, newMinPrice);
    }

    // Update sale status
    function updateMusicSaleStatus(
        uint256 tokenId,
        bool isForSale
    ) public onlyOwner {
        require(exists(tokenId), "Music does not exist");
        musicCollection[tokenId].isForSale = isForSale;
        emit MusicSaleStatusUpdated(tokenId, isForSale);
    }

    // Purchase music NFT with flexible price
    function purchaseMusic(uint256 tokenId) public payable nonReentrant {
        require(exists(tokenId), "Music does not exist");
        require(musicCollection[tokenId].isForSale, "Music is not for sale");
        require(
            msg.value >= musicCollection[tokenId].minPrice,
            "Price below minimum"
        );

        address seller = ownerOf(tokenId);

        // Transfer NFT
        _transfer(seller, msg.sender, tokenId);

        // 90% to the seller, 10% to the creator
        uint256 creatorFee = (msg.value * 10) / 100;
        uint256 sellerAmount = msg.value - creatorFee;

        // Transfer payment to seller
        (bool sentToSeller, ) = payable(seller).call{value: sellerAmount}("");
        require(sentToSeller, "Failed to send Ether to seller");

        // Transfer creator fee
        (bool sentToCreator, ) = payable(musicCollection[tokenId].creator).call{
            value: creatorFee
        }("");
        require(sentToCreator, "Failed to send Ether to creator");

        // Update sale status
        musicCollection[tokenId].isForSale = false;

        emit MusicPurchased(tokenId, msg.sender, msg.value);
    }

    // Get metadata URI
    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        require(exists(tokenId), "Music does not exist");
        return musicCollection[tokenId].uri;
    }

    // Get minimum price
    function getMinPrice(uint256 tokenId) public view returns (uint256) {
        require(exists(tokenId), "Music does not exist");
        return musicCollection[tokenId].minPrice;
    }

    // Get all music info
    function getAllMusic() public view returns (Music[] memory) {
        uint256 totalSupply = _tokenIds.current();
        Music[] memory allMusic = new Music[](totalSupply);

        for (uint256 i = 1; i <= totalSupply; i++) {
            allMusic[i - 1] = musicCollection[i];
        }

        return allMusic;
    }

    // Get music info by tokenId
    function getMusicByTokenId(
        uint256 tokenId
    ) public view returns (Music memory) {
        require(exists(tokenId), "Music does not exist");
        return musicCollection[tokenId];
    }

    // Get total supply
    function totalSupply() public view returns (uint256) {
        return _tokenIds.current();
    }
}
