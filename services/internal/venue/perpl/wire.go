package perpl

import "encoding/json"

// Message types on both WebSockets, as published in the API docs.
const (
	msgPing              = 1
	msgPong              = 2
	msgStatusResponse    = 3
	msgSubscribeRequest  = 5
	msgSubscribeResponse = 6
	msgGasPriceUpdate    = 7
	msgMarketConfig      = 8
	msgMarketState       = 9
	msgMarketFunding     = 10
	msgCandlesSnapshot   = 11
	msgCandlesUpdate     = 12
	msgBookSnapshot      = 15
	msgBookUpdate        = 16
	msgTradesSnapshot    = 17
	msgTradesUpdate      = 18
	msgWalletSnapshot    = 19
	msgWalletUpdate      = 20
	msgAccountUpdate     = 21
	msgOrderRequest      = 22
	msgOrdersSnapshot    = 23
	msgOrdersUpdate      = 24
	msgFillsUpdate       = 25
	msgPositionsSnapshot = 26
	msgPositionsUpdate   = 27
	msgAccountStats      = 28
	msgAPIKeySignIn      = 29
	msgHeartbeat         = 100
)

// Order types.
const (
	orderOpenLong   = 1
	orderOpenShort  = 2
	orderCloseLong  = 3
	orderCloseShort = 4
	orderCancel     = 5
	orderChange     = 7
)

// Order flags.
const (
	flagGoodTillCancel    = 0
	flagPostOnly          = 1
	flagFillOrKill        = 2
	flagImmediateOrCancel = 4
)

// Order statuses.
const (
	statusPending         = 1
	statusOpen            = 2
	statusPartiallyFilled = 3
	statusFilled          = 4
	statusCanceled        = 5
	statusExpired         = 6
	statusFailed          = 7
	statusUntriggered     = 8
	statusTriggered       = 9
	statusExecuted        = 10
)

// Status reasons worth naming: these are the ones a caller acts on rather than
// merely logs. The full list is in the API docs.
const (
	reasonExceedsLastExecutionBlock = 14
	reasonOrderDescIDTooLow         = 32
	reasonOrderForwardingNotAllowed = 34
)

// Liquidity side on a fill.
const (
	liquidityMaker = 1
	liquidityTaker = 2
)

// Position sides and statuses.
const (
	positionLong  = 1
	positionShort = 2

	positionStatusOpen = 1
)

// header is the common preamble on every WebSocket frame.
type header struct {
	MsgType int    `json:"mt"`
	SubID   int64  `json:"sid,omitempty"`
	Seq     int64  `json:"sn,omitempty"`
	CorrID  int64  `json:"cid,omitempty"`
	Session string `json:"ses,omitempty"`
}

// blockTime is the venue's timestamp: a block number and a millisecond clock.
type blockTime struct {
	Block int64 `json:"b,omitempty"`
	Time  int64 `json:"t,omitempty"`
}

// --- REST: /v1/pub/context ---

type contextResponse struct {
	Chain     chainInfo          `json:"chain"`
	Instances []protocolInstance `json:"instances"`
	Tokens    []token            `json:"tokens"`
	Markets   []market           `json:"markets"`
}

type chainInfo struct {
	ChainID  int64    `json:"chain_id"`
	Name     string   `json:"name"`
	Explorer []string `json:"block_explorer_urls"`
	Gas      struct {
		At   blockTime `json:"at"`
		Head int64     `json:"h"`
	} `json:"gas"`
}

type protocolInstance struct {
	ID                   int    `json:"id"`
	Address              string `json:"address"`
	CollateralTokenID    int    `json:"collateral_token_id"`
	MinAccountOpenAmount string `json:"min_account_open_amount"`
	MinDepositAmount     string `json:"min_deposit_amount"`
	MinWithdrawAmount    string `json:"min_withdraw_amount"`
}

type token struct {
	ID               int    `json:"id"`
	Address          string `json:"address"`
	Symbol           string `json:"symbol"`
	Name             string `json:"name"`
	Decimals         int    `json:"decimals"`
	DisplayPrecision int    `json:"display_precision"`
}

type market struct {
	ID         int    `json:"id"`
	InstanceID int    `json:"instance_id"`
	Symbol     string `json:"symbol"`
	Name       string `json:"name"`
	SizeUnits  string `json:"size_units"`

	FundingIntervalSec int `json:"funding_interval_sec"`
	OrderTTLBlocks     int `json:"order_ttl_blocks"`
	OrderRetryBlocks   int `json:"order_retry_blocks"`
	MaxSlippageBps     int `json:"order_max_market_slippage_bps"`
	MaxNegPnLCollatBps int `json:"order_max_neg_pnl_collat_bps"`

	Config marketConfig `json:"config"`
	State  marketState  `json:"state"`
}

// ticker is the market's venue-independent name. Testnet fills `symbol` and
// leaves `name` as "BTC Perp"; mainnet leaves `symbol` empty on some markets and
// puts the ticker in `name`. Prefer the shorter, non-empty one.
func (m market) ticker() string {
	if m.Symbol != "" {
		return m.Symbol
	}
	return m.Name
}

type marketConfig struct {
	At            blockTime `json:"at"`
	IsOpen        bool      `json:"is_open"`
	PriceDecimals int       `json:"price_decimals"`
	SizeDecimals  int       `json:"size_decimals"`
	MinPosting    string    `json:"min_posting_amount"`
	MinSettle     string    `json:"min_settle_amount"`
	// InitialMargin is the maximum leverage in hundredths: 1500 is 15x.
	// MaintenanceMargin is the leverage at which the venue liquidates.
	InitialMargin     int     `json:"initial_margin"`
	MaintenanceMargin int     `json:"maintenance_margin"`
	MakerFee          int64   `json:"maker_fee"`
	TakerFee          int64   `json:"taker_fee"`
	MakerFees         []int64 `json:"maker_fees"`
	TakerFees         []int64 `json:"taker_fees"`
	// RecycleFee is charged per posted order, in collateral units.
	RecycleFee string `json:"recycle_fee"`
}

// feeMicros returns the rate for a fee tier, falling back to the base rate when
// the schedule arrays are absent or the tier is out of range.
func (c marketConfig) feeMicros(tier int, maker bool) int64 {
	tiers, base := c.TakerFees, c.TakerFee
	if maker {
		tiers, base = c.MakerFees, c.MakerFee
	}
	if tier >= 0 && tier < len(tiers) {
		return tiers[tier]
	}
	return base
}

type marketState struct {
	At     blockTime `json:"at"`
	Oracle int64     `json:"orl"`
	Mark   int64     `json:"mrk"`
	Last   int64     `json:"lst"`
	Mid    int64     `json:"mid"`
	Bid    int64     `json:"bid"`
	Ask    int64     `json:"ask"`
	Prev   int64     `json:"prv"`
	OI     int64     `json:"oi"`
}

// --- Market data streams ---

type subscribeRequest struct {
	MsgType int                `json:"mt"`
	Subs    []subscribeElement `json:"subs"`
}

type subscribeElement struct {
	Stream    string `json:"stream"`
	Subscribe bool   `json:"subscribe"`
}

type subscribeResponse struct {
	MsgType int `json:"mt"`
	Subs    []struct {
		Stream string `json:"stream"`
		SubID  int64  `json:"sid"`
		Status *struct {
			Code  int    `json:"code"`
			Error string `json:"error"`
		} `json:"status"`
	} `json:"subs"`
}

type candleSeries struct {
	MsgType    int       `json:"mt"`
	SubID      int64     `json:"sid"`
	At         blockTime `json:"at"`
	Resolution int       `json:"r"`
	Data       []candle  `json:"d"`
}

type candle struct {
	Time   int64  `json:"t"`
	Open   int64  `json:"o"`
	Close  int64  `json:"c"`
	High   int64  `json:"h"`
	Low    int64  `json:"l"`
	Volume string `json:"v"`
	Trades int    `json:"n"`
}

type bookMessage struct {
	MsgType int         `json:"mt"`
	SubID   int64       `json:"sid"`
	At      blockTime   `json:"at"`
	Bids    []bookLevel `json:"bid"`
	Asks    []bookLevel `json:"ask"`
}

type bookLevel struct {
	Price  int64 `json:"p"`
	Size   int64 `json:"s"`
	Orders int   `json:"o"`
}

type marketStateUpdate struct {
	MsgType int                    `json:"mt"`
	Data    map[string]marketState `json:"d"`
}

type heartbeat struct {
	MsgType int   `json:"mt"`
	Seq     int64 `json:"sn"`
	Head    int64 `json:"h"`
}

type ping struct {
	MsgType int   `json:"mt"`
	Time    int64 `json:"t"`
}

// --- Trading ---

type apiKeySignIn struct {
	MsgType   int    `json:"mt"`
	ChainID   int64  `json:"chain_id"`
	APIKey    string `json:"api_key"`
	Timestamp string `json:"timestamp"`
	Nonce     string `json:"nonce"`
	Signature string `json:"signature"`
}

// orderRequest is the mt:22 frame.
//
// Two fields are easy to get wrong and expensive when wrong: `rq` is the
// idempotency key and must strictly increase per account (seeded from
// Account.lfr), and `lb` is the last block the order may execute at, which must
// satisfy head < lb <= head + order_ttl_blocks.
type orderRequest struct {
	MsgType        int    `json:"mt"`
	Seq            int64  `json:"sn"`
	RequestID      uint64 `json:"rq"`
	Market         int    `json:"mkt"`
	Account        uint64 `json:"acc"`
	OrderID        uint64 `json:"oid,omitempty"`
	Type           int    `json:"t"`
	Price          int64  `json:"p,omitempty"`
	Size           int64  `json:"s"`
	MaxSlippageBps int    `json:"ms,omitempty"`
	MaxNegPnLBps   int    `json:"mnp,omitempty"`
	Flags          int    `json:"fl"`
	Leverage       int    `json:"lv"`
	LastBlock      int64  `json:"lb"`
	BuilderFee     int    `json:"bf,omitempty"`
}

type statusResponse struct {
	MsgType int   `json:"mt"`
	SubID   int64 `json:"sid"`
	CorrID  int64 `json:"cid"`
	Status  struct {
		Code  int    `json:"code"`
		Error string `json:"error"`
	} `json:"status"`
}

type wallet struct {
	MsgType  int       `json:"mt"`
	Seq      int64     `json:"sn"`
	At       blockTime `json:"at"`
	Address  string    `json:"addr"`
	Accounts []account `json:"as"`
}

type account struct {
	MsgType    int    `json:"mt"`
	InstanceID int    `json:"in"`
	ID         uint64 `json:"id"`
	Frozen     bool   `json:"fr"`
	Forwarding bool   `json:"fw"`
	FeeTier    int    `json:"ft"`
	LastReqID  uint64 `json:"lfr"`
	Balance    string `json:"b"`
	Locked     string `json:"lb"`
}

type ordersMessage struct {
	MsgType int       `json:"mt"`
	At      blockTime `json:"at"`
	Data    []order   `json:"d"`
}

type order struct {
	At         blockTime `json:"at"`
	RequestID  uint64    `json:"rq"`
	Market     int       `json:"mkt"`
	Account    uint64    `json:"acc"`
	OrderID    uint64    `json:"oid"`
	Status     int       `json:"st"`
	Reason     int       `json:"sr"`
	Failure    int       `json:"fr"`
	Type       int       `json:"t"`
	Removed    bool      `json:"r"`
	Price      int64     `json:"p"`
	OrigSize   int64     `json:"os"`
	FillPrice  int64     `json:"fp"`
	FillSize   int64     `json:"fs"`
	Fee        string    `json:"f"`
	BuilderFee string    `json:"bfa"`
	Flags      int       `json:"fl"`
	Leverage   int       `json:"lv"`
}

type fillsMessage struct {
	MsgType int       `json:"mt"`
	At      blockTime `json:"at"`
	Data    []fill    `json:"d"`
}

type fill struct {
	At         blockTime `json:"at"`
	Market     int       `json:"mkt"`
	Account    uint64    `json:"acc"`
	OrderID    uint64    `json:"oid"`
	Type       int       `json:"t"`
	Liquidity  int       `json:"l"`
	Price      int64     `json:"p"`
	Size       int64     `json:"s"`
	Fee        string    `json:"f"`
	BuilderFee string    `json:"bfa"`
}

type positionsMessage struct {
	MsgType int        `json:"mt"`
	At      blockTime  `json:"at"`
	Data    []position `json:"d"`
}

type position struct {
	At         blockTime `json:"at"`
	Market     int       `json:"mkt"`
	Account    uint64    `json:"acc"`
	PositionID uint64    `json:"pid"`
	Status     int       `json:"st"`
	Side       int       `json:"sd"`
	Collateral string    `json:"c"`
	EntryPrice int64     `json:"ep"`
	Size       int64     `json:"s"`
	Fee        string    `json:"fee"`
	Leverage   int       `json:"lv"`
	DeltaPnL   string    `json:"dpnl"`
	Funding    string    `json:"fnd"`
	ExitPrice  int64     `json:"xp"`
	OpenedAt   blockTime `json:"ots"`
}

// peekMsgType reads only the message type from a frame, so the reader can
// dispatch without unmarshalling the body twice.
func peekMsgType(b []byte) (int, error) {
	var h struct {
		MsgType int `json:"mt"`
	}
	if err := json.Unmarshal(b, &h); err != nil {
		return 0, err
	}
	return h.MsgType, nil
}
