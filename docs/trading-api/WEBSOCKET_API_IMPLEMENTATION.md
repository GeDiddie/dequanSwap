# WebSocket API Implementation Guide

## Overview

This document provides technical implementation details for the dequanW Trading WebSocket API server. This server exposes core trading functionality from dequanBuy and dequanSell services to third-party frontends.

### Where this code runs

- **This WebSocket API server should run inside the `dequanW` runtime (server-side), next to your bot services.**
- Your separate swap UI project should be a **client** of this server.
- Do not embed long-lived secrets (like a static API key) in browser code for a public website; use a small auth backend to mint short-lived tokens if needed.

---

## Architecture

```
┌────────────────────────────────────────────────────┐
│                WebSocket API Server                │
│                 (Port 8900)                        │
├────────────────────────────────────────────────────┤
│  - Connection Manager (auth, sessions)             │
│  - Message Router (buy, sell, subscribe)           │
│  - Real-time Event Emitter (price, position)       │
└─────────┬──────────────────────────────────────────┘
          │
          ├──► dequanBuy/strategies/buyStrategy.js
          │    └─► Buy execution logic
          │
          ├──► dequanSell/strategies/sellStrategy.js
          │    └─► Sell execution logic
          │
          ├──► dequanBuy/utils/WebSocketService.js
          │    └─► SolanaTracker real-time market data
          │
          └──► shared/holdingsDB.js
               └─► Position tracking
```

---

## Core Components

### 1. WebSocket Server (`tradingAPI/server.js`)

```javascript
import { WebSocketServer } from 'ws';
import http from 'http';
import { EventEmitter } from 'events';
import config from '../shared/config.js';
import logger from '../shared/logger.js';

class TradingAPIServer extends EventEmitter {
  constructor(port = 8900) {
    super();
    this.port = port;
    this.clients = new Map(); // clientId -> { ws, authenticated, subscriptions }
    this.server = null;
    this.wss = null;
  }
  
  start() {
    // Create HTTP server
    this.server = http.createServer();
    
    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.server });
    
    // Handle new connections
    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      this.handleConnection(clientId, ws, req);
    });
    
    // Start listening
    this.server.listen(this.port, () => {
      logger.info(`[TradingAPI] WebSocket server started on port ${this.port}`);
    });
  }
  
  handleConnection(clientId, ws, req) {
    const client = {
      ws,
      authenticated: false,
      subscriptions: new Set(),
      ip: req.socket.remoteAddress
    };
    
    this.clients.set(clientId, client);
    logger.info(`[TradingAPI] New connection from ${client.ip} (${clientId})`);
    
    // Handle messages
    ws.on('message', (data) => {
      this.handleMessage(clientId, data);
    });
    
    // Handle disconnect
    ws.on('close', () => {
      this.handleDisconnect(clientId);
    });
    
    // Handle errors
    ws.on('error', (error) => {
      logger.error(`[TradingAPI] WebSocket error for ${clientId}: ${error.message}`);
    });
  }
  
  handleMessage(clientId, data) {
    try {
      const message = JSON.parse(data.toString());
      const client = this.clients.get(clientId);
      
      if (!client) return;
      
      // Route message based on type
      switch (message.type) {
        case 'auth':
          this.handleAuth(clientId, message);
          break;
          
        case 'buy':
          if (client.authenticated) {
            this.handleBuy(clientId, message.params);
          } else {
            this.sendError(clientId, 'AUTH_FAILED', 'Not authenticated');
          }
          break;
          
        case 'sell':
          if (client.authenticated) {
            this.handleSell(clientId, message.params);
          } else {
            this.sendError(clientId, 'AUTH_FAILED', 'Not authenticated');
          }
          break;
          
        case 'get_position':
          if (client.authenticated) {
            this.handleGetPosition(clientId, message.params);
          } else {
            this.sendError(clientId, 'AUTH_FAILED', 'Not authenticated');
          }
          break;
          
        case 'set_params':
          if (client.authenticated) {
            this.handleSetParams(clientId, message.params);
          } else {
            this.sendError(clientId, 'AUTH_FAILED', 'Not authenticated');
          }
          break;
          
        case 'subscribe':
          if (client.authenticated) {
            this.handleSubscribe(clientId, message.params);
          } else {
            this.sendError(clientId, 'AUTH_FAILED', 'Not authenticated');
          }
          break;
          
        case 'unsubscribe':
          if (client.authenticated) {
            this.handleUnsubscribe(clientId, message.params);
          } else {
            this.sendError(clientId, 'AUTH_FAILED', 'Not authenticated');
          }
          break;
          
        case 'get_balance':
          if (client.authenticated) {
            this.handleGetBalance(clientId);
          } else {
            this.sendError(clientId, 'AUTH_FAILED', 'Not authenticated');
          }
          break;
          
        // Non-custodial endpoints
        case 'quote':
          if (client.authenticated) {
            this.handleQuote(clientId, message.params);
          } else {
            this.sendError(clientId, 'AUTH_FAILED', 'Not authenticated');
          }
          break;
          
        case 'build_swap_tx':
          if (client.authenticated) {
            this.handleBuildSwapTx(clientId, message.params);
          } else {
            this.sendError(clientId, 'AUTH_FAILED', 'Not authenticated');
          }
          break;
          
        case 'submit_signed_tx':
          if (client.authenticated) {
            this.handleSubmitSignedTx(clientId, message.params);
          } else {
            this.sendError(clientId, 'AUTH_FAILED', 'Not authenticated');
          }
          break;
          
        default:
          this.sendError(clientId, 'INVALID_MESSAGE', `Unknown message type: ${message.type}`);
      }
    } catch (error) {
      logger.error(`[TradingAPI] Error handling message from ${clientId}: ${error.message}`);
      this.sendError(clientId, 'PARSE_ERROR', 'Invalid JSON');
    }
  }
  
  handleAuth(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    // Validate API key
    const validKey = config.tradingAPI?.apiKey || process.env.TRADING_API_KEY;
    
    if (message.apiKey === validKey) {
      client.authenticated = true;
      this.send(clientId, {
        type: 'auth_success',
        message: 'Authentication successful'
      });
      logger.info(`[TradingAPI] Client ${clientId} authenticated`);
    } else {
      this.sendError(clientId, 'AUTH_FAILED', 'Invalid API key');
      // Close connection after auth failure
      setTimeout(() => {
        client.ws.close();
      }, 1000);
    }
  }
  
  async handleBuy(clientId, params) {
    try {
      // Import BuyStrategy
      const { default: BuyStrategy } = await import('../dequanBuy/strategies/buyStrategy.js');
      const { wsService } = await import('../dequanBuy/utils/WebSocketService.js');
      const { default: SpikeMonitoringService } = await import('../dequanBuy/services/spikeMonitoringService.js');
      
      // Initialize services if needed
      if (!this.buyStrategy) {
        const spikeMonitoring = new SpikeMonitoringService(wsService);
        this.buyStrategy = new BuyStrategy(wsService, spikeMonitoring);
        logger.info('[TradingAPI] BuyStrategy initialized');
      }
      
      // Validate parameters
      if (!params.tokenAddress) {
        this.sendError(clientId, 'INVALID_PARAMS', 'tokenAddress is required');
        return;
      }
      
      if (!params.amountSOL || params.amountSOL <= 0) {
        this.sendError(clientId, 'INVALID_PARAMS', 'amountSOL must be positive');
        return;
      }
      
      // Prepare token data
      const tokenData = {
        tokenAAddress: params.tokenAddress,
        tokenBAddress: 'So11111111111111111111111111111111111111112', // SOL
        name: params.tokenName || 'Token',
        symbol: params.symbol || 'TKN',
        poolId: params.poolId || '',
        
        // Use provided values or fetch from WebSocket
        currentPrice: params.price || 0,
        liquidity: params.liquidity || 0,
        marketCap: params.marketCap || 0,
        
        // Override buy settings
        customBuyAmount: params.amountSOL,
        customSlippage: params.slippage,
        customPriorityFee: params.priorityFee
      };
      
      // Execute buy
      const result = await this.buyStrategy.executeBuy(tokenData);
      
      if (result.success) {
        this.send(clientId, {
          type: 'buy_result',
          success: true,
          data: {
            txHash: result.txHash,
            tokenAddress: params.tokenAddress,
            tokenAmount: result.tokenAmount,
            solSpent: result.solSpent,
            executionTime: result.executionTime,
            buyPrice: result.buyPrice,
            marketCap: result.marketCap,
            liquidity: result.liquidity
          }
        });
      } else {
        this.sendError(clientId, 'BUY_FAILED', result.error || 'Buy execution failed');
      }
    } catch (error) {
      logger.error(`[TradingAPI] Buy error: ${error.message}`);
      this.sendError(clientId, 'BUY_ERROR', error.message);
    }
  }
  
  async handleSell(clientId, params) {
    try {
      // Import SellStrategy
      const { default: SellStrategy } = await import('../dequanSell/strategies/sellStrategy.js');
      
      // Initialize sell strategy if needed
      if (!this.sellStrategy) {
        this.sellStrategy = new SellStrategy();
        logger.info('[TradingAPI] SellStrategy initialized');
      }
      
      // Validate parameters
      if (!params.tokenAddress) {
        this.sendError(clientId, 'INVALID_PARAMS', 'tokenAddress is required');
        return;
      }
      
      const percentage = params.percentage || 100;
      if (percentage < 1 || percentage > 100) {
        this.sendError(clientId, 'INVALID_PARAMS', 'percentage must be between 1 and 100');
        return;
      }
      
      // Get holding from database
      const { getHoldingByAddress } = await import('../shared/holdingsDB.js');
      const holding = await getHoldingByAddress(params.tokenAddress);
      
      if (!holding) {
        this.sendError(clientId, 'POSITION_NOT_FOUND', 'No position found for this token');
        return;
      }
      
      // Execute sell
      const result = await this.sellStrategy.executeSell(holding, {
        percentage,
        slippage: params.slippage,
        priorityFee: params.priorityFee,
        reason: 'API request'
      });
      
      if (result.success) {
        this.send(clientId, {
          type: 'sell_result',
          success: true,
          data: {
            txHash: result.txHash,
            tokenAddress: params.tokenAddress,
            tokensSold: result.tokensSold,
            solReceived: result.solReceived,
            profitLoss: result.profitLoss,
            profitLossPercent: result.profitLossPercent,
            executionTime: result.executionTime
          }
        });
      } else {
        this.sendError(clientId, 'SELL_FAILED', result.error || 'Sell execution failed');
      }
    } catch (error) {
      logger.error(`[TradingAPI] Sell error: ${error.message}`);
      this.sendError(clientId, 'SELL_ERROR', error.message);
    }
  }
  
  async handleGetPosition(clientId, params) {
    try {
      const { getHoldingByAddress } = await import('../shared/holdingsDB.js');
      const holding = await getHoldingByAddress(params.tokenAddress);
      
      if (!holding) {
        this.sendError(clientId, 'POSITION_NOT_FOUND', 'No position found');
        return;
      }
      
      // Calculate current value and PnL
      const currentPrice = holding.currentPriceUSD || 0;
      const currentValue = (holding.tokenAmount * currentPrice) / Math.pow(10, holding.tokenDecimal);
      const solSpent = holding.solSpent || 0;
      const profitLoss = currentValue - solSpent;
      const profitLossPercent = solSpent > 0 ? (profitLoss / solSpent) * 100 : 0;
      
      this.send(clientId, {
        type: 'position_status',
        data: {
          tokenAddress: holding.tokenAddress,
          tokenName: holding.tokenName,
          tokenAmount: holding.tokenAmount,
          solSpent: solSpent,
          currentPrice: currentPrice,
          currentValue: currentValue,
          profitLoss: profitLoss,
          profitLossPercent: profitLossPercent,
          buyTime: holding.buyTime,
          holdingTime: Math.floor((Date.now() - new Date(holding.buyTime).getTime()) / 1000),
          strategy: {
            takeProfit: config.bot.takeProfit,
            stopLoss: config.bot.priceDropSellThreshold,
            trailingStop: config.bot.trailingStopLoss,
            maxHoldingTime: config.bot.maxHoldingTime
          }
        }
      });
    } catch (error) {
      logger.error(`[TradingAPI] Get position error: ${error.message}`);
      this.sendError(clientId, 'POSITION_ERROR', error.message);
    }
  }
  
  handleSetParams(clientId, params) {
    // Update config for specific token or globally
    // This would modify shared/config.js or token-specific overrides
    
    this.send(clientId, {
      type: 'params_updated',
      success: true,
      data: params
    });
  }
  
  handleSubscribe(clientId, params) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const { tokenAddress, channels } = params;
    
    // Subscribe to requested channels
    for (const channel of channels) {
      const subscriptionKey = `${tokenAddress}:${channel}`;
      client.subscriptions.add(subscriptionKey);
    }
    
    logger.info(`[TradingAPI] Client ${clientId} subscribed to ${channels.join(', ')} for ${tokenAddress.slice(0, 8)}...`);
    
    this.send(clientId, {
      type: 'subscribe_success',
      tokenAddress,
      channels
    });
  }
  
  handleUnsubscribe(clientId, params) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const { tokenAddress, channels } = params;
    
    // Unsubscribe from channels
    for (const channel of channels) {
      const subscriptionKey = `${tokenAddress}:${channel}`;
      client.subscriptions.delete(subscriptionKey);
    }
    
    this.send(clientId, {
      type: 'unsubscribe_success',
      tokenAddress,
      channels
    });
  }
  
  async handleGetBalance(clientId) {
    try {
      const { getWalletBalance } = await import('../dequanBuy/utils/wallet.js');
      const { getAllHoldings } = await import('../shared/holdingsDB.js');
      
      const solBalance = await getWalletBalance();
      const holdings = await getAllHoldings();
      
      const tokens = holdings.map(h => ({
        address: h.tokenAddress,
        name: h.tokenName,
        amount: h.tokenAmount,
        decimals: h.tokenDecimal,
        valueSOL: h.solSpent || 0,
        valueUSD: ((h.tokenAmount * (h.currentPriceUSD || 0)) / Math.pow(10, h.tokenDecimal)) || 0
      }));
      
      this.send(clientId, {
        type: 'balance',
        data: {
          sol: solBalance,
          tokens
        }
      });
    } catch (error) {
      logger.error(`[TradingAPI] Get balance error: ${error.message}`);
      this.sendError(clientId, 'BALANCE_ERROR', error.message);
    }
  }
  
  // Non-custodial handlers (for user-signed transactions)
  
  async handleQuote(clientId, params) {
    try {
      // Validate parameters
      if (!params.userPubkey) {
        this.sendError(clientId, 'INVALID_PARAMS', 'userPubkey is required');
        return;
      }
      
      if (!params.inputMint || !params.outputMint) {
        this.sendError(clientId, 'INVALID_PARAMS', 'inputMint and outputMint are required');
        return;
      }
      
      if (!params.amountIn || params.amountIn <= 0) {
        this.sendError(clientId, 'INVALID_PARAMS', 'amountIn must be positive');
        return;
      }
      
      // Get quote from Jupiter or your preferred aggregator
      // This is a simplified example - you'll need to integrate with Jupiter API
      const jupiterQuote = await this.getJupiterQuote({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amountIn,
        slippageBps: params.slippageBps || 4000 // Default 40% slippage
      });
      
      if (!jupiterQuote) {
        this.sendError(clientId, 'QUOTE_FAILED', 'Unable to get quote');
        return;
      }
      
      this.send(clientId, {
        type: 'quote_result',
        success: true,
        data: {
          amountIn: jupiterQuote.inAmount,
          amountOut: jupiterQuote.outAmount,
          minOut: jupiterQuote.otherAmountThreshold,
          priceImpactBps: jupiterQuote.priceImpactPct * 100,
          route: {
            provider: 'jupiter',
            hops: jupiterQuote.marketInfos?.length || 0,
            serializedQuote: JSON.stringify(jupiterQuote) // Store for build_swap_tx
          }
        }
      });
    } catch (error) {
      logger.error(`[TradingAPI] Quote error: ${error.message}`);
      this.sendError(clientId, 'QUOTE_ERROR', error.message);
    }
  }
  
  async handleBuildSwapTx(clientId, params) {
    try {
      // Validate parameters
      if (!params.userPubkey) {
        this.sendError(clientId, 'INVALID_PARAMS', 'userPubkey is required');
        return;
      }
      
      if (!params.quote || !params.quote.serializedQuote) {
        this.sendError(clientId, 'INVALID_PARAMS', 'quote with serializedQuote is required');
        return;
      }
      
      // Build transaction from Jupiter quote
      // This is a simplified example - integrate with Jupiter swap API
      const quote = JSON.parse(params.quote.serializedQuote);
      
      const swapTransaction = await this.buildJupiterSwapTransaction({
        userPublicKey: params.userPubkey,
        quote: quote,
        // Additional params like fee payer, etc.
      });
      
      if (!swapTransaction) {
        this.sendError(clientId, 'BUILD_TX_FAILED', 'Unable to build transaction');
        return;
      }
      
      this.send(clientId, {
        type: 'build_swap_tx_result',
        success: true,
        data: {
          transactionBase64: swapTransaction.swapTransaction, // Base64 encoded transaction
          recentBlockhash: swapTransaction.lastValidBlockHeight,
          lastValidBlockHeight: swapTransaction.lastValidBlockHeight
        }
      });
    } catch (error) {
      logger.error(`[TradingAPI] Build swap tx error: ${error.message}`);
      this.sendError(clientId, 'BUILD_TX_ERROR', error.message);
    }
  }
  
  async handleSubmitSignedTx(clientId, params) {
    try {
      // Validate parameters
      if (!params.signedTransactionBase64) {
        this.sendError(clientId, 'INVALID_PARAMS', 'signedTransactionBase64 is required');
        return;
      }
      
      // Import Solana connection
      const { Connection, Transaction } = await import('@solana/web3.js');
      const connection = new Connection(config.rpc.mainnet.http, 'confirmed');
      
      // Decode and send transaction
      const txBuffer = Buffer.from(params.signedTransactionBase64, 'base64');
      const transaction = Transaction.from(txBuffer);
      
      const txHash = await connection.sendRawTransaction(txBuffer, {
        skipPreflight: false,
        maxRetries: 3
      });
      
      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(txHash, 'confirmed');
      
      if (confirmation.value.err) {
        this.sendError(clientId, 'TX_FAILED', `Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        return;
      }
      
      this.send(clientId, {
        type: 'submit_signed_tx_result',
        success: true,
        data: {
          txHash: txHash
        }
      });
      
      logger.info(`[TradingAPI] User-signed transaction submitted: ${txHash}`);
    } catch (error) {
      logger.error(`[TradingAPI] Submit signed tx error: ${error.message}`);
      this.sendError(clientId, 'SUBMIT_TX_ERROR', error.message);
    }
  }
  
  // Helper methods for Jupiter integration
  
  async getJupiterQuote(params) {
    // This is a placeholder - integrate with actual Jupiter API
    // https://quote-api.jup.ag/v6/quote
    try {
      const response = await fetch(
        `https://quote-api.jup.ag/v6/quote?` +
        `inputMint=${params.inputMint}&` +
        `outputMint=${params.outputMint}&` +
        `amount=${params.amount}&` +
        `slippageBps=${params.slippageBps}`
      );
      
      if (!response.ok) {
        throw new Error(`Jupiter quote failed: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.error(`[TradingAPI] Jupiter quote error: ${error.message}`);
      return null;
    }
  }
  
  async buildJupiterSwapTransaction(params) {
    // This is a placeholder - integrate with actual Jupiter swap API
    // https://quote-api.jup.ag/v6/swap
    try {
      const response = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: params.quote,
          userPublicKey: params.userPublicKey,
          wrapAndUnwrapSol: true,
          // Additional configuration
        })
      });
      
      if (!response.ok) {
        throw new Error(`Jupiter swap build failed: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      logger.error(`[TradingAPI] Jupiter swap build error: ${error.message}`);
      return null;
    }
  }
  
  handleDisconnect(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      logger.info(`[TradingAPI] Client ${clientId} disconnected`);
      this.clients.delete(clientId);
    }
  }
  
  send(clientId, data) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === 1) { // OPEN
      client.ws.send(JSON.stringify(data));
    }
  }
  
  sendError(clientId, code, message, details = {}) {
    this.send(clientId, {
      type: 'error',
      code,
      message,
      details
    });
  }
  
  broadcast(data, filter = null) {
    for (const [clientId, client] of this.clients.entries()) {
      if (!filter || filter(client)) {
        this.send(clientId, data);
      }
    }
  }
  
  broadcastUpdate(tokenAddress, channel, data) {
    const subscriptionKey = `${tokenAddress}:${channel}`;
    
    for (const [clientId, client] of this.clients.entries()) {
      if (client.subscriptions.has(subscriptionKey)) {
        this.send(clientId, {
          type: 'update',
          channel,
          data: {
            tokenAddress,
            ...data,
            timestamp: Date.now()
          }
        });
      }
    }
  }
  
  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

export default TradingAPIServer;
```

---

### 2. Real-Time Update Integration

Connect the API server to WebSocket market data feeds:

```javascript
// tradingAPI/realtimeIntegration.js

import { wsService } from '../dequanBuy/utils/WebSocketService.js';
import logger from '../shared/logger.js';

export class RealtimeIntegration {
  constructor(apiServer) {
    this.apiServer = apiServer;
    this.subscribedTokens = new Set();
  }
  
  start() {
    logger.info('[RealtimeIntegration] Starting real-time update integration');
    
    // Listen for new subscriptions from API clients
    this.apiServer.on('subscription_added', ({ tokenAddress, channel }) => {
      this.subscribeToToken(tokenAddress);
    });
  }
  
  subscribeToToken(tokenAddress) {
    if (this.subscribedTokens.has(tokenAddress)) return;
    
    this.subscribedTokens.add(tokenAddress);
    
    // Subscribe to price updates
    const priceRoom = `price:aggregated:${tokenAddress}`;
    wsService.on(priceRoom, (update) => {
      this.handlePriceUpdate(tokenAddress, update);
    });
    wsService.joinRoom(priceRoom);
    
    // Subscribe to transaction updates
    const txRoom = `transaction:${tokenAddress}`;
    wsService.on(txRoom, (tx) => {
      this.handleTransactionUpdate(tokenAddress, tx);
    });
    wsService.joinRoom(txRoom);
    
    logger.info(`[RealtimeIntegration] Subscribed to updates for ${tokenAddress.slice(0, 8)}...`);
  }
  
  handlePriceUpdate(tokenAddress, update) {
    const price = update.aggregated?.median || update.price || 0;
    const topPool = update.topPools?.[0];
    const marketCap = topPool?.marketCap?.usd || topPool?.marketCap || 0;
    const liquidity = topPool?.liquidity?.usd || topPool?.liquidity || 0;
    
    // Broadcast to subscribed clients
    this.apiServer.broadcastUpdate(tokenAddress, 'price', {
      price,
      marketCap,
      liquidity
    });
  }
  
  handleTransactionUpdate(tokenAddress, tx) {
    // Broadcast transaction to subscribed clients
    this.apiServer.broadcastUpdate(tokenAddress, 'transactions', {
      type: tx.eventType || tx.type,
      amount: tx.volume || tx.amount || 0,
      wallet: tx.wallet || tx.owner,
      timestamp: tx.timestamp || Date.now()
    });
  }
}
```

---

### 3. Position Monitoring

Automatically update clients with position changes:

```javascript
// tradingAPI/positionMonitor.js

import { getAllHoldings } from '../shared/holdingsDB.js';
import { wsService } from '../dequanBuy/utils/WebSocketService.js';
import logger from '../shared/logger.js';

export class PositionMonitor {
  constructor(apiServer) {
    this.apiServer = apiServer;
    this.positions = new Map();
  }
  
  async start() {
    logger.info('[PositionMonitor] Starting position monitoring');
    
    // Load existing positions
    await this.loadPositions();
    
    // Monitor for price changes
    setInterval(() => {
      this.updatePositions();
    }, 5000); // Every 5 seconds
  }
  
  async loadPositions() {
    const holdings = await getAllHoldings();
    
    for (const holding of holdings) {
      this.positions.set(holding.tokenAddress, {
        ...holding,
        lastUpdate: Date.now()
      });
      
      // Subscribe to price updates
      const priceRoom = `price:aggregated:${holding.tokenAddress}`;
      wsService.on(priceRoom, (update) => {
        this.handlePositionPriceUpdate(holding.tokenAddress, update);
      });
      wsService.joinRoom(priceRoom);
    }
    
    logger.info(`[PositionMonitor] Loaded ${holdings.length} positions`);
  }
  
  handlePositionPriceUpdate(tokenAddress, update) {
    const position = this.positions.get(tokenAddress);
    if (!position) return;
    
    const price = update.aggregated?.median || update.price || 0;
    const topPool = update.topPools?.[0];
    const marketCap = topPool?.marketCap?.usd || topPool?.marketCap || 0;
    const liquidity = topPool?.liquidity?.usd || topPool?.liquidity || 0;
    
    // Calculate PnL
    const currentValue = (position.tokenAmount * price) / Math.pow(10, position.tokenDecimal);
    const solSpent = position.solSpent || 0;
    const profitLoss = currentValue - solSpent;
    const profitLossPercent = solSpent > 0 ? (profitLoss / solSpent) * 100 : 0;
    
    // Update position cache
    position.currentPrice = price;
    position.currentValue = currentValue;
    position.profitLoss = profitLoss;
    position.profitLossPercent = profitLossPercent;
    position.lastUpdate = Date.now();
    
    // Broadcast to subscribed clients
    this.apiServer.broadcastUpdate(tokenAddress, 'position', {
      currentPrice: price,
      currentValue,
      profitLoss,
      profitLossPercent,
      marketCap,
      liquidity
    });
  }
  
  async updatePositions() {
    // Reload positions from database (in case new buys/sells happened)
    const holdings = await getAllHoldings();
    
    for (const holding of holdings) {
      if (!this.positions.has(holding.tokenAddress)) {
        // New position detected
        this.positions.set(holding.tokenAddress, {
          ...holding,
          lastUpdate: Date.now()
        });
        
        // Subscribe to updates
        const priceRoom = `price:aggregated:${holding.tokenAddress}`;
        wsService.joinRoom(priceRoom);
      }
    }
    
    // Remove closed positions
    for (const tokenAddress of this.positions.keys()) {
      if (!holdings.find(h => h.tokenAddress === tokenAddress)) {
        this.positions.delete(tokenAddress);
        wsService.leaveRoom(`price:aggregated:${tokenAddress}`);
      }
    }
  }
}
```

---

### 4. Main Server Entry Point

```javascript
// tradingAPI/index.js

import TradingAPIServer from './server.js';
import { RealtimeIntegration } from './realtimeIntegration.js';
import { PositionMonitor } from './positionMonitor.js';
import logger from '../shared/logger.js';
import config from '../shared/config.js';

async function main() {
  logger.info('[TradingAPI] Starting dequanW Trading API Server');
  
  // Initialize WebSocket server
  const port = config.tradingAPI?.port || 8900;
  const apiServer = new TradingAPIServer(port);
  apiServer.start();
  
  // Initialize real-time data integration
  const realtimeIntegration = new RealtimeIntegration(apiServer);
  realtimeIntegration.start();
  
  // Initialize position monitoring
  const positionMonitor = new PositionMonitor(apiServer);
  await positionMonitor.start();
  
  logger.info('[TradingAPI] ✅ All services started successfully');
}

// Error handling
process.on('uncaughtException', (error) => {
  logger.error('[TradingAPI] Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  logger.error('[TradingAPI] Unhandled rejection:', error);
});

// Start server
main().catch((error) => {
  logger.error('[TradingAPI] Fatal error:', error);
  process.exit(1);
});
```

---

### 5. Configuration

Add to `shared/config.js`:

```javascript
tradingAPI: {
  enabled: true,
  port: 8900,
  apiKey: process.env.TRADING_API_KEY || 'your-secure-api-key-here',
  
  // Rate limiting
  rateLimit: {
    maxBuysPerSecond: 10,
    maxSellsPerSecond: 10,
    maxRequestsPerMinute: 100
  },
  
  // Security
  allowedIPs: [], // Empty = allow all, or ['127.0.0.1', '192.168.1.100']
  
  // WebSocket settings
  pingInterval: 30000, // 30 seconds
  connectionTimeout: 60000, // 60 seconds
  
  // Features
  allowCustomSlippage: true,
  allowCustomPriorityFee: true,
  enforceMinBuyAmount: true,
  minBuyAmountSOL: 0.001
}
```

---

## Deployment

### PM2 Configuration

Add to `ecosystem.config.js`:

```javascript
{
  name: 'dequan-trading-api',
  script: './tradingAPI/index.js',
  instances: 1,
  exec_mode: 'fork',
  watch: false,
  max_memory_restart: '500M',
  env: {
    NODE_ENV: 'production',
    TRADING_API_KEY: 'your-secure-key-here'
  }
}
```

### Start API Server

```bash
pm2 start ecosystem.config.js --only dequan-trading-api
pm2 logs dequan-trading-api
```

---

## Testing

### Test Client

```javascript
// test-trading-api.js

import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8900');

ws.on('open', () => {
  console.log('✅ Connected to Trading API');
  
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    apiKey: 'your-api-key-here'
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📨 Received:', msg);
  
  if (msg.type === 'auth_success') {
    // Test buy
    ws.send(JSON.stringify({
      type: 'buy',
      params: {
        tokenAddress: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        amountSOL: 0.01,
        slippage: 40
      }
    }));
  }
});

ws.on('error', (error) => {
  console.error('❌ Error:', error.message);
});
```

Run test:
```bash
node test-trading-api.js
```

---

## Security Considerations

### 1. Authentication

- Private/dev: use strong API keys (minimum 32 characters) and rotate them.
- Public production: **do not** ship long-lived API keys to browsers. Use a Control Plane to mint **short-lived JWTs** and have the WS engine verify them via JWKS (`/jwks.json`).
- Always enforce auth server-side (UI gating is UX only).

### 2. Rate Limiting

```javascript
// tradingAPI/rateLimiter.js

export class RateLimiter {
  constructor(config) {
    this.limits = config;
    this.buckets = new Map(); // clientId -> bucket
  }
  
  checkLimit(clientId, action) {
    const bucket = this.getBucket(clientId);
    const limit = this.limits[action];
    
    if (!limit) return true;
    
    const now = Date.now();
    const windowStart = now - limit.window;
    
    // Remove old entries
    bucket[action] = bucket[action].filter(ts => ts > windowStart);
    
    // Check if limit exceeded
    if (bucket[action].length >= limit.max) {
      return false;
    }
    
    // Add new entry
    bucket[action].push(now);
    return true;
  }
  
  getBucket(clientId) {
    if (!this.buckets.has(clientId)) {
      this.buckets.set(clientId, {
        buy: [],
        sell: [],
        request: []
      });
    }
    return this.buckets.get(clientId);
  }
}
```

### 3. Input Validation

Always validate:
- Token addresses (valid Solana public keys)
- Amounts (positive numbers, within limits)
- Slippage (0-100%)
- Priority fees (reasonable SOL amounts)

---

## Monitoring

### Health Check Endpoint

```javascript
// Add to server.js
this.server.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      connections: this.clients.size,
      memory: process.memoryUsage()
    }));
  }
});
```

### Metrics Collection

```javascript
// tradingAPI/metrics.js

export class MetricsCollector {
  constructor() {
    this.metrics = {
      totalBuys: 0,
      totalSells: 0,
      successfulBuys: 0,
      successfulSells: 0,
      failedBuys: 0,
      failedSells: 0,
      totalVolume: 0,
      avgExecutionTime: 0
    };
  }
  
  recordBuy(success, volume, executionTime) {
    this.metrics.totalBuys++;
    if (success) {
      this.metrics.successfulBuys++;
      this.metrics.totalVolume += volume;
    } else {
      this.metrics.failedBuys++;
    }
    this.updateAvgExecutionTime(executionTime);
  }
  
  recordSell(success, volume, executionTime) {
    this.metrics.totalSells++;
    if (success) {
      this.metrics.successfulSells++;
    } else {
      this.metrics.failedSells++;
    }
    this.updateAvgExecutionTime(executionTime);
  }
  
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.calculateSuccessRate()
    };
  }
  
  calculateSuccessRate() {
    const total = this.metrics.totalBuys + this.metrics.totalSells;
    const successful = this.metrics.successfulBuys + this.metrics.successfulSells;
    return total > 0 ? (successful / total) * 100 : 0;
  }
  
  updateAvgExecutionTime(newTime) {
    const total = this.metrics.totalBuys + this.metrics.totalSells;
    this.metrics.avgExecutionTime = 
      (this.metrics.avgExecutionTime * (total - 1) + newTime) / total;
  }
}
```

---

## Next Steps

1. **Create the directory structure:**
   ```bash
   mkdir -p tradingAPI
   touch tradingAPI/index.js
   touch tradingAPI/server.js
   touch tradingAPI/realtimeIntegration.js
   touch tradingAPI/positionMonitor.js
   touch tradingAPI/rateLimiter.js
   touch tradingAPI/metrics.js
   ```

2. **Install dependencies:**
   ```bash
   npm install ws
   ```

3. **Configure API key:**
   ```bash
   echo "TRADING_API_KEY=your-secure-key-$(openssl rand -hex 16)" >> .env
   ```

4. **Test the server:**
   ```bash
   node tradingAPI/index.js
   ```

5. **Deploy with PM2:**
   ```bash
   pm2 start ecosystem.config.js --only dequan-trading-api
   pm2 save
   ```

---

**Your trading bot core is ready to power any frontend! 🚀**
