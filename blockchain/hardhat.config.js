// require('@nomiclabs/hardhat-waffle');
// require('@nomiclabs/hardhat-ethers');
// require('dotenv').config();

// // console.log(process.env.INFURA_KEY)

// module.exports = {
//   solidity: '0.8.24',
//   networks: {
//     sepolia: {
//       url: `https://sepolia.infura.io/v3/${process.env.INFURA_KEY}`,
//       accounts: [process.env.PRIVATE_KEY]
//     }
//   }
// };

require('@nomiclabs/hardhat-waffle');
require('@nomiclabs/hardhat-ethers');
require('dotenv').config();

module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    sepolia: {
      url: `https://sepolia.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};