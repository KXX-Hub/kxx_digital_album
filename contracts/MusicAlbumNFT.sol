// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract MusicAlbumNFT is ERC721, Ownable, ReentrancyGuard, Pausable {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;
    Counters.Counter private _albumIds;

    // 版稅設定
    uint256 public creatorRoyalty;
    uint256 public sellerRoyalty;
    uint256 private constant ROYALTY_DENOMINATOR = 100;

    struct Album {
        string name;
        string uri;
        uint256 totalTracks;
        uint256 maxSupply; // 專輯最大發行量
        uint256 currentSupply; // 當前發行量
        mapping(uint256 => bool) trackExists;
        bool exists;
    }

    struct Track {
        string name;
        string uri;
        uint256 albumId;
        uint256 trackNumber;
        uint256 minPrice;
        uint256 maxSupply; // 音軌最大發行量
        uint256 currentSupply; // 當前發行量
        bool isForSale;
        address creator;
    }

    // Mappings
    mapping(uint256 => Album) public albums;
    mapping(uint256 => Track) public tracks;
    mapping(uint256 => mapping(uint256 => uint256)) private albumTrackToToken; // albumId => trackNumber => tokenId

    // Events
    event AlbumCreated(
        uint256 indexed albumId,
        string name,
        uint256 totalTracks,
        uint256 maxSupply
    );
    event TrackMinted(
        uint256 indexed tokenId,
        uint256 indexed albumId,
        uint256 trackNumber,
        string name,
        address owner
    );
    event TrackMinPriceUpdated(uint256 indexed tokenId, uint256 newMinPrice);
    event TrackSaleStatusUpdated(uint256 indexed tokenId, bool isForSale);
    event TrackPurchased(uint256 indexed tokenId, address buyer, uint256 price);
    event RoyaltyUpdated(uint256 creatorRoyalty, uint256 sellerRoyalty);
    event MaxSupplyUpdated(
        uint256 indexed albumId,
        uint256 trackNumber,
        uint256 maxSupply
    );

    constructor(
        uint256 _creatorRoyalty,
        uint256 _sellerRoyalty
    ) ERC721("KXX Digital Album", "KXXM") {
        require(
            _creatorRoyalty + _sellerRoyalty == ROYALTY_DENOMINATOR,
            "Invalid royalty settings"
        );
        creatorRoyalty = _creatorRoyalty;
        sellerRoyalty = _sellerRoyalty;
    }

    function createAlbum(
        string memory name,
        string memory uri,
        uint256 totalTracks,
        uint256 maxSupply
    ) public onlyOwner returns (uint256) {
        require(bytes(name).length > 0, "Name cannot be empty");
        require(bytes(uri).length > 0, "URI cannot be empty");
        require(totalTracks > 0, "Total tracks must be greater than 0");
        require(maxSupply > 0, "Max supply must be greater than 0");

        _albumIds.increment();
        uint256 newAlbumId = _albumIds.current();

        Album storage newAlbum = albums[newAlbumId];
        newAlbum.name = name;
        newAlbum.uri = uri;
        newAlbum.totalTracks = totalTracks;
        newAlbum.maxSupply = maxSupply;
        newAlbum.currentSupply = 0;
        newAlbum.exists = true;

        emit AlbumCreated(newAlbumId, name, totalTracks, maxSupply);
        return newAlbumId;
    }

    function mintTrack(
        uint256 albumId,
        uint256 trackNumber,
        string memory name,
        string memory uri,
        uint256 minPrice,
        uint256 maxSupply
    ) public onlyOwner whenNotPaused returns (uint256) {
        require(albums[albumId].exists, "Album does not exist");
        require(
            trackNumber > 0 && trackNumber <= albums[albumId].totalTracks,
            "Invalid track number"
        );
        require(
            !albums[albumId].trackExists[trackNumber],
            "Track already exists"
        );
        require(bytes(name).length > 0, "Name cannot be empty");
        require(bytes(uri).length > 0, "URI cannot be empty");
        require(maxSupply > 0, "Max supply must be greater than 0");

        _tokenIds.increment();
        uint256 newTokenId = _tokenIds.current();

        _safeMint(msg.sender, newTokenId);

        tracks[newTokenId] = Track({
            name: name,
            uri: uri,
            albumId: albumId,
            trackNumber: trackNumber,
            minPrice: minPrice,
            maxSupply: maxSupply,
            currentSupply: 1,
            isForSale: true,
            creator: msg.sender
        });

        albums[albumId].trackExists[trackNumber] = true;
        albums[albumId].currentSupply++;
        albumTrackToToken[albumId][trackNumber] = newTokenId;

        require(
            albums[albumId].currentSupply <= albums[albumId].maxSupply,
            "Album supply limit reached"
        );

        emit TrackMinted(newTokenId, albumId, trackNumber, name, msg.sender);
        return newTokenId;
    }

    function mintAdditionalCopy(
        uint256 albumId,
        uint256 trackNumber
    ) public onlyOwner whenNotPaused returns (uint256) {
        require(albums[albumId].exists, "Album does not exist");
        require(
            albums[albumId].trackExists[trackNumber],
            "Track does not exist"
        );

        uint256 originalTokenId = albumTrackToToken[albumId][trackNumber];
        Track storage track = tracks[originalTokenId];

        require(
            track.currentSupply < track.maxSupply,
            "Track supply limit reached"
        );
        require(
            albums[albumId].currentSupply < albums[albumId].maxSupply,
            "Album supply limit reached"
        );

        _tokenIds.increment();
        uint256 newTokenId = _tokenIds.current();

        _safeMint(msg.sender, newTokenId);

        tracks[newTokenId] = Track({
            name: track.name,
            uri: track.uri,
            albumId: track.albumId,
            trackNumber: track.trackNumber,
            minPrice: track.minPrice,
            maxSupply: track.maxSupply,
            currentSupply: track.currentSupply + 1,
            isForSale: true,
            creator: track.creator
        });

        track.currentSupply++;
        albums[albumId].currentSupply++;

        emit TrackMinted(
            newTokenId,
            albumId,
            trackNumber,
            track.name,
            msg.sender
        );
        return newTokenId;
    }

    function purchaseTrack(
        uint256 tokenId
    ) public payable whenNotPaused nonReentrant {
        require(_exists(tokenId), "Track does not exist");
        require(tracks[tokenId].isForSale, "Track is not for sale");
        require(msg.value >= tracks[tokenId].minPrice, "Price below minimum");

        address seller = ownerOf(tokenId);
        require(msg.sender != seller, "Cannot buy your own track");

        _transfer(seller, msg.sender, tokenId);

        // 計算版稅分配
        uint256 creatorAmount = (msg.value * creatorRoyalty) /
            ROYALTY_DENOMINATOR;
        uint256 sellerAmount = msg.value - creatorAmount;

        (bool sentToSeller, ) = payable(seller).call{value: sellerAmount}("");
        require(sentToSeller, "Failed to send Ether to seller");

        (bool sentToCreator, ) = payable(tracks[tokenId].creator).call{
            value: creatorAmount
        }("");
        require(sentToCreator, "Failed to send Ether to creator");

        tracks[tokenId].isForSale = false;

        emit TrackPurchased(tokenId, msg.sender, msg.value);
    }

    // 管理功能
    function setRoyalty(
        uint256 _creatorRoyalty,
        uint256 _sellerRoyalty
    ) public onlyOwner {
        require(
            _creatorRoyalty + _sellerRoyalty == ROYALTY_DENOMINATOR,
            "Invalid royalty settings"
        );
        creatorRoyalty = _creatorRoyalty;
        sellerRoyalty = _sellerRoyalty;
        emit RoyaltyUpdated(_creatorRoyalty, _sellerRoyalty);
    }

    function setTrackMaxSupply(
        uint256 albumId,
        uint256 trackNumber,
        uint256 newMaxSupply
    ) public onlyOwner {
        require(albums[albumId].exists, "Album does not exist");
        require(
            albums[albumId].trackExists[trackNumber],
            "Track does not exist"
        );
        uint256 tokenId = albumTrackToToken[albumId][trackNumber];
        require(
            newMaxSupply >= tracks[tokenId].currentSupply,
            "New max supply too low"
        );
        tracks[tokenId].maxSupply = newMaxSupply;
        emit MaxSupplyUpdated(albumId, trackNumber, newMaxSupply);
    }

    function setAlbumMaxSupply(
        uint256 albumId,
        uint256 newMaxSupply
    ) public onlyOwner {
        require(albums[albumId].exists, "Album does not exist");
        require(
            newMaxSupply >= albums[albumId].currentSupply,
            "New max supply too low"
        );
        albums[albumId].maxSupply = newMaxSupply;
        emit MaxSupplyUpdated(albumId, 0, newMaxSupply);
    }

    function updateTrackPrice(
        uint256 tokenId,
        uint256 newMinPrice
    ) public onlyOwner {
        require(_exists(tokenId), "Track does not exist");
        tracks[tokenId].minPrice = newMinPrice;
        emit TrackMinPriceUpdated(tokenId, newMinPrice);
    }

    function updateTrackSaleStatus(
        uint256 tokenId,
        bool isForSale
    ) public onlyOwner {
        require(_exists(tokenId), "Track does not exist");
        tracks[tokenId].isForSale = isForSale;
        emit TrackSaleStatusUpdated(tokenId, isForSale);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    // 查詢功能
    function getAlbumTracks(
        uint256 albumId
    ) public view returns (Track[] memory) {
        require(albums[albumId].exists, "Album does not exist");

        Track[] memory albumTracks = new Track[](albums[albumId].totalTracks);
        uint256 count = 0;

        for (
            uint256 trackNumber = 1;
            trackNumber <= albums[albumId].totalTracks;
            trackNumber++
        ) {
            if (albums[albumId].trackExists[trackNumber]) {
                uint256 tokenId = albumTrackToToken[albumId][trackNumber];
                albumTracks[count] = tracks[tokenId];
                count++;
            }
        }

        return albumTracks;
    }

    function getTrackSupply(
        uint256 albumId,
        uint256 trackNumber
    ) public view returns (uint256 current, uint256 max) {
        require(albums[albumId].exists, "Album does not exist");
        require(
            albums[albumId].trackExists[trackNumber],
            "Track does not exist"
        );
        uint256 tokenId = albumTrackToToken[albumId][trackNumber];
        return (tracks[tokenId].currentSupply, tracks[tokenId].maxSupply);
    }

    function getAlbumSupply(
        uint256 albumId
    ) public view returns (uint256 current, uint256 max) {
        require(albums[albumId].exists, "Album does not exist");
        return (albums[albumId].currentSupply, albums[albumId].maxSupply);
    }

    // Override 必要函數
    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        require(_exists(tokenId), "Track does not exist");
        return tracks[tokenId].uri;
    }

    function exists(uint256 tokenId) public view returns (bool) {
        return _exists(tokenId);
    }

    function totalAlbums() public view returns (uint256) {
        return _albumIds.current();
    }

    function totalSupply() public view returns (uint256) {
        return _tokenIds.current();
    }
}
