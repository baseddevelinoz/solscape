const { VersionedTransaction, Connection, PublicKey } = solanaWeb3;

import {
  ASSHOLE_FEE,
  COMMITMENT,
  DEFAULT_INPUT_TOKEN_SYMBOL,
  DEFAULT_OUTPUT_TOKEN_SYMBOL,
  DEFAULT_SLIPPAGE,
  DOLLAR_CURRENCY_SYMBOL,
  GET_QUOTE_DELAY,
  JUPITER_FEES_IN_SOL,
  MAX_RETRY_TIME,
  MAX_SLIPPAGE_ALLOWED,
  REFERRAL_ACCOUNT_OUT_TOKENS,
  REFERRAL_ACCOUNT_PUBKEY,
  REFETCH_TX_INTERVAL_MS,
  RPC_URL_SOLANA,
  SPL_TOKEN,
  SWAP_LOGO_URL,
  SWAP_NAME,
  UPDATE_QUOTE_INTERVAL,
  WALLET_ADDRESS_LETTER_COUNT,
} from "./constants.js";

// All interactive stuff declared below.
const getPhantomBtn = document.getElementById("getPhantomBtn");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const tokenInInput = document.getElementById("tokenInInput");
const tokenOutInput = document.getElementById("tokenOutInput");
const swapSection = document.getElementById("swapSection");
const swapBtn = document.getElementById("swapBtn");
const swapTokensBtn = document.getElementById("swapTokensBtn");
const tokenInMenu = document.getElementById("tokenInMenu");
const tokenOutMenu = document.getElementById("tokenOutMenu");
const tokenInBalanceSpan = document.getElementById("tokenInBalanceSpan");
const tokenOutBalanceSpan = document.getElementById("tokenOutBalanceSpan");
const tokenInBalanceSymbolSpan = document.getElementById(
  "tokenInBalanceSymbolSpan"
);
const tokenOutBalanceSymbolSpan = document.getElementById(
  "tokenOutBalanceSymbolSpan"
);
const tokenInValueSpan = document.getElementById("tokenInValueSpan");
const tokenOutValueSpan = document.getElementById("tokenOutValueSpan");
const halfBtn = document.getElementById("halfBtn");
const maxBtn = document.getElementById("maxBtn");
const slippageInputWrapper = document.getElementById("slippageInputWrapper");
const slippageInput = document.getElementById("slippageInput");
const walletAddressSpan = document.getElementById("walletAddressSpan");
const txDetailsField = document.getElementById("txDetailsField");
const tokenRateSpan = document.getElementById("tokenRateSpan");
const priceImpactField = document.getElementById("priceImpactField");
const priceImpactSpan = document.getElementById("priceImpactSpan");
const minimumReceivedSpan = document.getElementById("minimumReceivedSpan");
const platformFeeSpan = document.getElementById("platformFeeSpan");
const swapLogo = document.getElementById("swapLogo");
const tokenInField = document.getElementById("tokenInField");
const tokenOutField = document.getElementById("tokenOutField");

// All global stuff we're gonna need declared below
const CONNECTION = new Connection(RPC_URL_SOLANA, COMMITMENT);
const PROVIDER = window.solana || window.phantom || window.solflare;
let inputToken = DEFAULT_INPUT_TOKEN_SYMBOL;
let outputToken = DEFAULT_OUTPUT_TOKEN_SYMBOL;
let platformFeeBps = 0;
let walletAddress;
let quoteResponse;
let tokenAccountInCache;
let tokenAccoutOutCache;
let quoteTimeoutId;
let quoteIntervalId;
let updateBalanceIntervalId;
let priceImpactPercent;
let feeAccountCache = {};
let allowReconnect = true;
let pauseAnimation = true;

//Connection handling
if (PROVIDER) {
  getPhantomBtn.style.display = "none";
  connectBtn.style.display = "inline";
  setInterval(() => {
    if (PROVIDER.isConnected) {
      const newPublicKey = PROVIDER.publicKey.toString();
      if (newPublicKey !== walletAddress) {
        setDisconnectedState();
        if (allowReconnect) PROVIDER.connect({ onlyIfTrusted: true });
      }
    } else {
      setDisconnectedState();
    }
  }, 1000);
  PROVIDER.on("connect", () => setConnectedState());
  try {
    PROVIDER.connect({ onlyIfTrusted: true });
  } catch (error) {}
} else {
  connectBtn.style.display = "none";
  if (isMobileBrowser)
    getPhantomBtn.children[0].href = `https://phantom.app/ul/v22.04.11`;
}

const isMobileBrowser = () => {
  return /iPhone|iPad|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
};

const connect = async () => {
  try {
    connectBtn.disabled = true;
    await PROVIDER.connect();
    allowReconnect = true;
    connectBtn.disabled = false;
  } catch (error) {
    connectBtn.disabled = false;
  }
};

const disconnect = () => {
  setDisconnectedState();
  allowReconnect = false;
};

const setConnectedState = () => {
  connectBtn.style.display = "none";
  swapSection.style.display = "inline-block";
  slippageInput.value = localStorage.getItem("slippage") || DEFAULT_SLIPPAGE;
  tokenInBalanceSymbolSpan.textContent = DEFAULT_INPUT_TOKEN_SYMBOL;
  tokenOutBalanceSymbolSpan.textContent = DEFAULT_OUTPUT_TOKEN_SYMBOL;
  disableSwap();
  disablePlatformFee();
  walletAddress = PROVIDER.publicKey.toString();
  walletAddressSpan.textContent = formatAddress(walletAddress);
  updateBalance();
  if (updateBalanceIntervalId) clearInterval(updateBalanceIntervalId);
  updateBalanceIntervalId = setInterval(updateBalance, 5000);
};

const setDisconnectedState = () => {
  connectBtn.style.display = "inline";
  swapSection.style.display = "none";
  tokenInBalanceSpan.textContent = "loading...";
  tokenOutBalanceSpan.textContent = "loading...";
  $("#tokenInMenu").val(`${DEFAULT_INPUT_TOKEN_SYMBOL}`).trigger("change");
  $("#tokenOutMenu").val(`${DEFAULT_OUTPUT_TOKEN_SYMBOL}`).trigger("change");
  walletAddressSpan.textContent = "";
  inputToken = DEFAULT_INPUT_TOKEN_SYMBOL;
  outputToken = DEFAULT_OUTPUT_TOKEN_SYMBOL;
  platformFeeBps = 0;
  walletAddress = undefined;
  tokenAccountInCache = undefined;
  tokenAccoutOutCache = undefined;
  clearInputs();
  clearQuoteEvents();
  clearCache();
  disablePlatformFee();
  if (updateBalanceIntervalId) clearInterval(updateBalanceIntervalId);
};

// Get jupiter quote after user inputs amount and GET_QUOTE_DELAY ms have passed
const updateQuote = async (value) => {
  clearQuoteEvents();
  tokenOutInput.value = "0";
  disableSwap();
  quoteTimeoutId = setTimeout(async () => {
    disableSwap();
    if (isPositiveNumber(value)) {
      const outAmount = await getQuote(value);
      tokenOutInput.value = outAmount;
      if (outputToken === DOLLAR_CURRENCY_SYMBOL)
        tokenOutValueSpan.textContent = outAmount.toFixed(2);
      tokenOutInput.value === "0" ? disableSwap() : enableSwap();
      if (!swapBtn.disabled) quoteIntervalId = updateQuoteInterval(value);
    }
  }, GET_QUOTE_DELAY);
};

//Update quote every UPDATE_QUOTE_INTERVAL ms
const updateQuoteInterval = (value) => {
  if (quoteIntervalId) clearInterval(quoteIntervalId);
  return setInterval(async () => {
    disableSwap();
    if (isPositiveNumber(value)) {
      const outAmount = await getQuote(value);
      tokenOutInput.value = outAmount;
      tokenOutInput.value === "0" ? disableSwap() : enableSwap();
    }
  }, UPDATE_QUOTE_INTERVAL);
};

// Get jupiter quote
const getQuote = async (amountString, customToken) => {
  await updatePlatformFee();
  const amount = Number(amountString);
  if (customToken === DOLLAR_CURRENCY_SYMBOL) return amount;
  const actualInToken = customToken ? customToken : inputToken;
  const actualOutToken = customToken ? DOLLAR_CURRENCY_SYMBOL : outputToken;
  try {
    const newQuoteResponse = await (
      await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${
          SPL_TOKEN[actualInToken].mint
        }&outputMint=${SPL_TOKEN[actualOutToken].mint}&amount=${Math.floor(
          amount * Math.pow(10, SPL_TOKEN[actualInToken].decimals)
        )}&slippageBps=${
          Number(slippageInput.value) * 100
        }&platformFeeBps=${platformFeeBps}`
      )
    ).json();
    if (!customToken) {
      quoteResponse = newQuoteResponse;
      priceImpactPercent = newQuoteResponse.priceImpactPct * 100;
      await updateDollarValue();
    }
    return (
      Number(newQuoteResponse.outAmount) /
      Math.pow(10, SPL_TOKEN[actualOutToken].decimals)
    );
  } catch (error) {
    console.error(error);
    return 0;
  }
};

// Util function for user input
const isPositiveNumber = (value) => /^(?=.*[1-9])\d*(?:\.\d+)?$/.test(value);

// Util function for wallet address display
const formatAddress = (address) =>
  address.slice(0, WALLET_ADDRESS_LETTER_COUNT) +
  "..." +
  address.slice(-WALLET_ADDRESS_LETTER_COUNT);

// Util function for filtering stuff like 0.00 as 0
const formatNumber = (value) => (parseFloat(value) === 0 ? 0 : value);

// Util function for converting to buffer
const bufferFrom = (input, encodeFirst = false) => {
  const encodedInput = encodeFirst ? btoa(input) : input;
  return new Uint8Array(
    atob(encodedInput)
      .split("")
      .map((char) => char.charCodeAt(0))
  );
};

// Update user balances
const updateBalance = async () => {
  if (PROVIDER.isConnected) {
    const updateTokenBalance = async (token, element) => {
      const balance = await getBalance(token);
      element.textContent = balance < 0.000001 ? 0 : balance;
    };
    swapTokensBtn.disabled = true;
    await updateTokenBalance(inputToken, tokenInBalanceSpan);
    await updateTokenBalance(outputToken, tokenOutBalanceSpan);
    swapTokensBtn.disabled = false;
  }
};

// Get token balance for both inputs
const getBalance = async (tokenName) => {
  try {
    if (tokenName === "SOL")
      return (
        (await CONNECTION.getBalance(new PublicKey(walletAddress))) /
        Math.pow(10, SPL_TOKEN.SOL.decimals)
      );
    else {
      const account = await getTokenAccount(
        SPL_TOKEN[tokenName].mint,
        tokenName === inputToken ? "in" : "out"
      );
      if (account)
        return (await CONNECTION.getTokenAccountBalance(account, COMMITMENT))
          .value.uiAmount;
      return 0;
    }
  } catch (error) {
    console.error(error);
    return 0;
  }
};

// For SPL tokens, we fetch token account first
const getTokenAccount = async (mintAddress, fieldType) => {
  let cachedTokenAccount =
    fieldType === "in" ? tokenAccountInCache : tokenAccoutOutCache;
  if (!cachedTokenAccount)
    try {
      const parsedTokenAccounts =
        await CONNECTION.getParsedTokenAccountsByOwner(
          new PublicKey(walletAddress),
          { mint: new PublicKey(mintAddress) }
        );
      // Filter out only token accounts with the specified mint
      if (parsedTokenAccounts.value.length <= 0) return undefined;
      cachedTokenAccount = parsedTokenAccounts.value[0].pubkey;
      fieldType === "in"
        ? (tokenAccountInCache = cachedTokenAccount)
        : (tokenAccoutOutCache = cachedTokenAccount);
      return cachedTokenAccount;
    } catch (error) {
      console.error("Error fetching token account:", error);
      return undefined;
    }
  return cachedTokenAccount;
};

// Get $ value of in and out tokens
const updateDollarValue = async () => {
  const quoteInUSDC = await getQuote(tokenInInput.value, inputToken);
  tokenInValueSpan.textContent = quoteInUSDC.toFixed(2);
  if (outputToken !== DOLLAR_CURRENCY_SYMBOL)
    tokenOutValueSpan.textContent = (
      (quoteInUSDC * (100 - priceImpactPercent)) /
      100
    ).toFixed(2);
};

// Swap input and output tokens
const swapTokens = () => {
  let temp = inputToken;
  inputToken = outputToken;
  outputToken = temp;

  $("#tokenInMenu").val(`${inputToken}`).trigger("change");
  $("#tokenOutMenu").val(`${outputToken}`).trigger("change");

  tokenInBalanceSymbolSpan.textContent = inputToken;
  tokenOutBalanceSymbolSpan.textContent = outputToken;

  temp = tokenAccountInCache;
  tokenAccountInCache = tokenAccoutOutCache;
  tokenAccoutOutCache = temp;

  temp = tokenInBalanceSpan.textContent;
  tokenInBalanceSpan.textContent = tokenOutBalanceSpan.textContent;
  tokenOutBalanceSpan.textContent = temp;

  clearInputs();
  clearQuoteEvents();

  tokenInField.classList.remove("animation-up");
  tokenInField.offsetWidth;
  tokenInField.classList.add("animation-up");
  tokenOutField.classList.remove("animation-down");
  tokenOutField.offsetWidth;
  tokenOutField.classList.add("animation-down");
};

// Charge (ASSHOLE_FEE / 100) % fee if not buying our own token
const updatePlatformFee = async () => {
  if (
    ![outputToken].includes(DEFAULT_OUTPUT_TOKEN_SYMBOL) &&
    REFERRAL_ACCOUNT_OUT_TOKENS.includes(outputToken) &&
    ASSHOLE_FEE
  ) {
    platformFeeBps = ASSHOLE_FEE;
    if (!feeAccountCache[outputToken]) {
      const [feeAccount] = await PublicKey.findProgramAddressSync(
        [
          bufferFrom("referral_ata", true),
          new PublicKey(REFERRAL_ACCOUNT_PUBKEY).toBuffer(), // your referral account public key
          new PublicKey(SPL_TOKEN[outputToken].mint).toBuffer(), // the token mint, output mint for ExactIn, input mint for ExactOut.
        ],
        new PublicKey("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3") // the Referral Program
      );
      feeAccountCache[outputToken] = feeAccount;
    }
  } else disablePlatformFee();
};

const disablePlatformFee = () => {
  platformFeeBps = 0;
};

const updateInput = (balance) => {
  if (isPositiveNumber(balance)) {
    if (inputToken === "SOL") {
      const balanceAfterFees = balance - JUPITER_FEES_IN_SOL;
      if (balanceAfterFees > 0) {
        tokenInInput.value = balanceAfterFees;
        updateQuote(balanceAfterFees);
      } else tokenInInput.value = 0;
      return;
    }
    tokenInInput.value = balance;
    updateQuote(balance);
  }
};

const enableSwap = async () => {
  swapBtn.disabled = false;
  const outputAmount = Number(tokenOutInput.value);
  tokenRateSpan.textContent = `1 ${inputToken} ≈ ${
    outputAmount / Number(tokenInInput.value)
  } ${outputToken}`;
  priceImpactSpan.textContent = formatNumber(priceImpactPercent.toFixed(2));
  let warningColor;
  if (priceImpactPercent < 1) warningColor = "inherit";
  else if (priceImpactPercent < 3) warningColor = "lightgreen";
  else if (priceImpactPercent < 5) warningColor = "yellow";
  else if (priceImpactPercent < 8) warningColor = "orange";
  else warningColor = "red";
  priceImpactField.style.color = warningColor;
  minimumReceivedSpan.textContent =
    ((outputAmount * (100 - Number(slippageInput.value))) / 100).toString() +
    ` ${outputToken}`;
  platformFeeSpan.textContent = formatNumber((platformFeeBps / 100).toFixed(2));
  txDetailsField.style.visibility = "visible";
};

const disableSwap = () => {
  swapBtn.disabled = true;
  txDetailsField.style.visibility = "hidden";
};

// Clear events we don't need anymore
const clearQuoteEvents = () => {
  if (quoteTimeoutId) clearTimeout(quoteTimeoutId);
  if (quoteIntervalId) clearInterval(quoteIntervalId);
  quoteTimeoutId = undefined;
  quoteIntervalId = undefined;
  quoteResponse = undefined;
};

// Reset token inputs
const clearInputs = () => {
  tokenInInput.value = "0";
  tokenOutInput.value = "0";
  disableSwap();
  clearTokenValues();
};

// Reset token values
const clearTokenValues = () => {
  tokenInValueSpan.textContent = "0";
  tokenOutValueSpan.textContent = "0";
};

// Clear cache
const clearCache = () => {
  tokenAccountInCache = undefined;
  tokenAccoutOutCache = undefined;
  feeAccountCache = {};
};

// Wait for transaction to be confirmed, check every REFETCH_TX_INTERVAL_MS for a period of MAX_RETRY_TIME
const txIsConfirmed = async (signature) => {
  if (signature)
    try {
      if (signature) {
        const startTime = Date.now();
        while (Date.now() - startTime <= MAX_RETRY_TIME) {
          const status = await CONNECTION.getSignatureStatus(signature, {
            searchTransactionHistory: true,
          });
          if (status?.value?.confirmationStatus) {
            const { confirmationStatus } = status.value;
            if (
              confirmationStatus === "confirmed" ||
              confirmationStatus === "finalized"
            )
              return true; // Transaction is confirmed or finalized
          }
          await new Promise((resolve) =>
            setTimeout(resolve, REFETCH_TX_INTERVAL_MS)
          );
        }
        console.error(`${signature} has no confirmationStatus`);
        return false;
      }
    } catch (error) {
      console.error("Error checking transaction status:", error);
    }
  return false;
};

getPhantomBtn.addEventListener("click", () => {
  getPhantomBtn.children[0].click();
});

// Connect wallet
connectBtn.addEventListener("click", async () => {
  await connect();
});

disconnectBtn.addEventListener("click", () => disconnect());

slippageInputWrapper.addEventListener("click", () => {
  slippageInput.focus();
});

// Update quote after slippage is modified
slippageInput.addEventListener("input", () => {
  let { value } = slippageInput;
  if (!value) slippageInput.value = 0;
  if (value.length === 2 && value[0] === "0" && !isNaN(value[1]))
    slippageInput.value = value.slice(1);
  if (Number(value) > MAX_SLIPPAGE_ALLOWED) {
    value = MAX_SLIPPAGE_ALLOWED;
    slippageInput.value = value;
  }
  if (value.length > 5) slippageInput.value = value.slice(0, -1);
  localStorage.setItem("slippage", Number(slippageInput.value).toString());
  updateQuote(tokenInInput.value);
});

// Get quote after user inputs amount
tokenInInput.addEventListener("input", async () => {
  const { value } = tokenInInput;
  if (!value) tokenInInput.value = 0;
  if (value.length >= 2 && value[0] === "0" && !isNaN(value[1]))
    tokenInInput.value = value.slice(1);
  clearTokenValues();
  updateQuote(tokenInInput.value);
});

// Get quote for half the user balance, send it
halfBtn.addEventListener("click", () =>
  updateInput(Number(tokenInBalanceSpan.textContent) / 2)
);

// Get quote for all user balance, SEND IT
maxBtn.addEventListener("click", () =>
  updateInput(Number(tokenInBalanceSpan.textContent))
);

// Swap IN and OUT tokens
swapTokensBtn.addEventListener("click", async () => swapTokens());

// Update output token
tokenOutMenu.addEventListener("change", () => {
  if (tokenOutMenu.value === inputToken) swapTokens();
  else {
    outputToken = tokenOutMenu.value;
    tokenAccoutOutCache = undefined;
    tokenOutBalanceSpan.textContent = "loading...";
    clearInputs();
    clearQuoteEvents();
  }
});

// Swap after quote is received
swapBtn.addEventListener("click", async () => {
  try {
    disableSwap();
    const body = {
      quoteResponse,
      userPublicKey: walletAddress,
    };
    if (platformFeeBps) body.feeAccount = feeAccountCache[outputToken];
    const { swapTransaction } = await (
      await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    ).json();

    // deserialize the transaction
    const swapTransactionBuf = bufferFrom(swapTransaction);
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    const { signature } = await PROVIDER.signAndSendTransaction(transaction);
    await txIsConfirmed(signature);
    tokenOutInput.value === "0" ? disableSwap() : enableSwap();
  } catch (error) {
    console.error(error);
    tokenOutInput.value === "0" ? disableSwap() : enableSwap();
  }
});

//Init swap name and logo
document.getElementById("swapName").textContent = SWAP_NAME;
document.getElementById("swapLogo").src = SWAP_LOGO_URL;

swapLogo.addEventListener("animationiteration", () => {
  swapLogo.style.animationPlayState = pauseAnimation ? "paused" : "running";
});
swapLogo.addEventListener("mouseover", () => {
  pauseAnimation = false;
  swapLogo.style.animationPlayState = "running";
});
swapLogo.addEventListener("mouseout", () => (pauseAnimation = true));

// Populate dropdown
$(document).ready(() => {
  $(".tokenMenu").select2({
    placeholder: "Select a token",
    templateResult: formatToken,
    templateSelection: formatToken,
    data: Object.keys(SPL_TOKEN).map((key) => ({ id: key, text: key })),
  });
  $("#tokenInMenu").val(`${DEFAULT_INPUT_TOKEN_SYMBOL}`).trigger("change");
  $("#tokenOutMenu").val(`${DEFAULT_OUTPUT_TOKEN_SYMBOL}`).trigger("change");
});

// Dropdown element template
const formatToken = (token) => {
  if (!token.id) {
    return token.text;
  }
  const tokenData = SPL_TOKEN[token.id];
  const $token = $(
    `<div class="tokenItem"><img src="${tokenData.url}" class="tokenLogo"/><span>${token.text}</span></div>`
  );
  return $token;
};

// Update input token
$("#tokenInMenu").on("change", function () {
  const selectedToken = $(this).val();
  if (selectedToken === inputToken) return;
  if (selectedToken === outputToken) swapTokens();
  else {
    inputToken = selectedToken;
    tokenAccountInCache = undefined;
    tokenInBalanceSpan.textContent = "loading...";
    tokenInBalanceSymbolSpan.textContent = inputToken;
    clearInputs();
    clearQuoteEvents();
  }
});

// Update output token
$("#tokenOutMenu").on("change", function () {
  const selectedToken = $(this).val();
  if (selectedToken === outputToken) return;
  if (selectedToken === inputToken) swapTokens();
  else {
    outputToken = selectedToken;
    tokenAccoutOutCache = undefined;
    tokenOutBalanceSpan.textContent = "loading...";
    tokenOutBalanceSymbolSpan.textContent = outputToken;
    clearInputs();
    clearQuoteEvents();
  }
});
