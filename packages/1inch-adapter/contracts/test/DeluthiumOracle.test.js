const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("DeluthiumOracle", function () {
  const NONE = "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF";

  async function deployOracleFixture() {
    const [owner, priceUpdater, other, addr1, addr2] = await ethers.getSigners();

    const DeluthiumOracle = await ethers.getContractFactory("DeluthiumOracle");
    const oracle = await DeluthiumOracle.deploy(priceUpdater.address);

    // Use dummy addresses as token stand-ins
    const srcToken = addr1.address;
    const dstToken = addr2.address;

    return { oracle, owner, priceUpdater, other, srcToken, dstToken };
  }

  describe("Deployment", function () {
    it("Should set the correct priceUpdater", async function () {
      const { oracle, priceUpdater } = await loadFixture(deployOracleFixture);
      expect(await oracle.priceUpdater()).to.equal(priceUpdater.address);
    });

    it("Should set the correct owner", async function () {
      const { oracle, owner } = await loadFixture(deployOracleFixture);
      expect(await oracle.owner()).to.equal(owner.address);
    });

    it("Should set default maxPriceAge to 300", async function () {
      const { oracle } = await loadFixture(deployOracleFixture);
      expect(await oracle.maxPriceAge()).to.equal(300);
    });

    it("Should revert on zero address priceUpdater", async function () {
      const DeluthiumOracle = await ethers.getContractFactory("DeluthiumOracle");
      await expect(
        DeluthiumOracle.deploy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(DeluthiumOracle, "ZeroAddress");
    });
  });

  describe("updatePrice", function () {
    it("Should update price when called by priceUpdater", async function () {
      const { oracle, priceUpdater, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      const rate = ethers.parseEther("1.5");
      const weight = ethers.parseEther("1000");

      await oracle.connect(priceUpdater).updatePrice(srcToken, dstToken, rate, weight);

      const priceData = await oracle.getPriceData(srcToken, dstToken);
      expect(priceData.rate).to.equal(rate);
      expect(priceData.weight).to.equal(weight);
      expect(priceData.timestamp).to.be.gt(0);
    });

    it("Should revert when called by non-priceUpdater", async function () {
      const { oracle, other, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      await expect(
        oracle.connect(other).updatePrice(srcToken, dstToken, 100, 100)
      ).to.be.revertedWithCustomError(oracle, "UnauthorizedUpdater");
    });

    it("Should emit PriceUpdated event", async function () {
      const { oracle, priceUpdater, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      const rate = ethers.parseEther("2.0");
      const weight = ethers.parseEther("500");

      await expect(oracle.connect(priceUpdater).updatePrice(srcToken, dstToken, rate, weight))
        .to.emit(oracle, "PriceUpdated")
        .withArgs(srcToken, dstToken, rate, weight, await time.latest() + 1);
    });
  });

  describe("batchUpdatePrices", function () {
    it("Should batch update multiple prices", async function () {
      const { oracle, priceUpdater } = await loadFixture(deployOracleFixture);

      const [, , , addr1, addr2] = await ethers.getSigners();
      const tokens = [addr1.address, addr2.address];
      const rates = [ethers.parseEther("1.0"), ethers.parseEther("2.0")];
      const weights = [ethers.parseEther("100"), ethers.parseEther("200")];

      await oracle.connect(priceUpdater).batchUpdatePrices(
        [tokens[0], tokens[1]],
        [tokens[1], tokens[0]],
        rates,
        weights
      );

      const data1 = await oracle.getPriceData(tokens[0], tokens[1]);
      expect(data1.rate).to.equal(rates[0]);

      const data2 = await oracle.getPriceData(tokens[1], tokens[0]);
      expect(data2.rate).to.equal(rates[1]);
    });

    it("Should revert on mismatched array lengths", async function () {
      const { oracle, priceUpdater, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      await expect(
        oracle.connect(priceUpdater).batchUpdatePrices(
          [srcToken],
          [dstToken, srcToken],
          [100],
          [100]
        )
      ).to.be.revertedWithCustomError(oracle, "InvalidArrayLength");
    });

    it("Should revert when called by non-priceUpdater", async function () {
      const { oracle, other, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      await expect(
        oracle.connect(other).batchUpdatePrices([srcToken], [dstToken], [100], [100])
      ).to.be.revertedWithCustomError(oracle, "UnauthorizedUpdater");
    });
  });

  describe("getRate", function () {
    it("Should return valid price with NONE connector", async function () {
      const { oracle, priceUpdater, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      const rate = ethers.parseEther("1.5");
      const weight = ethers.parseEther("1000");

      await oracle.connect(priceUpdater).updatePrice(srcToken, dstToken, rate, weight);

      const result = await oracle.getRate(srcToken, dstToken, NONE, 0);
      expect(result.rate).to.equal(rate);
      expect(result.weight).to.equal(weight);
    });

    it("Should revert with non-NONE connector", async function () {
      const { oracle, priceUpdater, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      const rate = ethers.parseEther("1.5");
      const weight = ethers.parseEther("1000");

      await oracle.connect(priceUpdater).updatePrice(srcToken, dstToken, rate, weight);

      await expect(
        oracle.getRate(srcToken, dstToken, srcToken, 0)
      ).to.be.revertedWithCustomError(oracle, "ConnectorShouldBeNone");
    });

    it("Should return (0, 0) when weight is below threshold", async function () {
      const { oracle, priceUpdater, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      const rate = ethers.parseEther("1.5");
      const weight = 100n;

      await oracle.connect(priceUpdater).updatePrice(srcToken, dstToken, rate, weight);

      const result = await oracle.getRate(srcToken, dstToken, NONE, 1000);
      expect(result.rate).to.equal(0);
      expect(result.weight).to.equal(0);
    });

    it("Should return (0, 0) for stale price", async function () {
      const { oracle, priceUpdater, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      const rate = ethers.parseEther("1.5");
      const weight = ethers.parseEther("1000");

      await oracle.connect(priceUpdater).updatePrice(srcToken, dstToken, rate, weight);

      // Advance time beyond maxPriceAge (300 seconds)
      await time.increase(301);

      const result = await oracle.getRate(srcToken, dstToken, NONE, 0);
      expect(result.rate).to.equal(0);
      expect(result.weight).to.equal(0);
    });

    it("Should return (0, 0) for non-existent price", async function () {
      const { oracle, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      const result = await oracle.getRate(srcToken, dstToken, NONE, 0);
      expect(result.rate).to.equal(0);
      expect(result.weight).to.equal(0);
    });
  });

  describe("isPriceFresh", function () {
    it("Should return true for fresh price", async function () {
      const { oracle, priceUpdater, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      await oracle.connect(priceUpdater).updatePrice(srcToken, dstToken, 100, 100);
      expect(await oracle.isPriceFresh(srcToken, dstToken)).to.be.true;
    });

    it("Should return false for stale price", async function () {
      const { oracle, priceUpdater, srcToken, dstToken } = await loadFixture(deployOracleFixture);

      await oracle.connect(priceUpdater).updatePrice(srcToken, dstToken, 100, 100);
      await time.increase(301);
      expect(await oracle.isPriceFresh(srcToken, dstToken)).to.be.false;
    });

    it("Should return false for non-existent price", async function () {
      const { oracle, srcToken, dstToken } = await loadFixture(deployOracleFixture);
      expect(await oracle.isPriceFresh(srcToken, dstToken)).to.be.false;
    });
  });

  describe("Admin functions", function () {
    describe("setPriceUpdater", function () {
      it("Should allow owner to set new priceUpdater", async function () {
        const { oracle, owner, other } = await loadFixture(deployOracleFixture);

        await expect(oracle.connect(owner).setPriceUpdater(other.address))
          .to.emit(oracle, "PriceUpdaterChanged");

        expect(await oracle.priceUpdater()).to.equal(other.address);
      });

      it("Should revert when non-owner calls setPriceUpdater", async function () {
        const { oracle, other } = await loadFixture(deployOracleFixture);

        await expect(
          oracle.connect(other).setPriceUpdater(other.address)
        ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
      });

      it("Should revert on zero address", async function () {
        const { oracle, owner } = await loadFixture(deployOracleFixture);

        await expect(
          oracle.connect(owner).setPriceUpdater(ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(oracle, "ZeroAddress");
      });

      it("Should emit PriceUpdaterChanged with correct args", async function () {
        const { oracle, owner, priceUpdater, other } = await loadFixture(deployOracleFixture);

        await expect(oracle.connect(owner).setPriceUpdater(other.address))
          .to.emit(oracle, "PriceUpdaterChanged")
          .withArgs(priceUpdater.address, other.address);
      });
    });

    describe("setMaxPriceAge", function () {
      it("Should allow owner to set maxPriceAge", async function () {
        const { oracle, owner } = await loadFixture(deployOracleFixture);

        await oracle.connect(owner).setMaxPriceAge(600);
        expect(await oracle.maxPriceAge()).to.equal(600);
      });

      it("Should revert when non-owner calls setMaxPriceAge", async function () {
        const { oracle, other } = await loadFixture(deployOracleFixture);

        await expect(
          oracle.connect(other).setMaxPriceAge(600)
        ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
      });

      it("Should emit MaxPriceAgeChanged with correct args", async function () {
        const { oracle, owner } = await loadFixture(deployOracleFixture);

        await expect(oracle.connect(owner).setMaxPriceAge(600))
          .to.emit(oracle, "MaxPriceAgeChanged")
          .withArgs(300, 600);
      });
    });
  });
});
