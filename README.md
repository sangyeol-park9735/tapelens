# TapeLens

**See, run and share any TapeOut circuit on X Layer — in the browser, with no wallet.**

TapeOut circuits are NAND/LATCH netlists stored on X Layer. They are verifiable, but hard to *look at*: a circuit is just bytes behind a processor contract. TapeLens turns any circuit ID into something you can see, poke at and prove.

## What it does
- **Open any circuit** on a TapeOut processor (FAB-Genisis, TAPELIQUID, OrderGuard) by ID, or jump to a random one. The processor's circuit count is found on-chain.
- **See it.** The netlist is decoded and drawn as a gate graph. Every wire lights up live as you flip input pins.
- **Run it on X Layer.** One click calls the processor's `eval(id, inputs)` and compares the on-chain output bit by bit with the in-browser simulation, stamped with the block number.
- **Truth table** for circuits with up to 10 inputs.
- **Check a seller's claim, not the circuit against itself.** Write the expected behaviour (`o0 = i0 ^ i1`, one line per output). TapeLens runs *every* input row through the contract's `eval()` on X Layer (up to 8 inputs = 256 on-chain rows, batched) and lists each row where the chain disagrees with the spec.
- **What is this circuit?** Each output is matched against a library of primitives (NOT, AND, OR, XOR, NAND, NOR, XNOR, MUX, majority/carry, 3-input sum…) with input permutations, e.g. circuit #3968 on FAB-Genisis is identified as a 4-bit binary-to-Gray-code converter (`o0 = i0⊕i1, o1 = i1⊕i2, o2 = i2⊕i3, o3 = i3`).
- **Function fingerprint and twin finder.** A canonical hash of the full truth table. TapeLens scans neighbouring circuits on-chain and lists those computing exactly the same function, marking smaller ones. That helps buyers pick the cheapest equivalent circuit and lets designers spot duplicates.
- **Embeddable verification badge** (`badge.html`). One `<iframe>` re-runs the on-chain row check every time a marketplace or project page loads, against the published spec if one is attached. See `demo-market.html`.
- **Share proof.** The share link encodes processor, circuit and inputs (`?p=…&id=…&in=…&run=1`). Anyone opening it re-runs the same on-chain check.

## TapeOut integration
Read-only calls to TapeOut processor contracts on X Layer mainnet (chain 196) through the public RPC `https://rpc.xlayer.tech`:

| Call | Selector | Use |
|---|---|---|
| `circuitInfo(uint256)` | `0x084d60f1` | inputs, outputs, state bits, gate count; circuit count by binary search |
| `netlist(uint256)` | `0x3fc4be56` | raw TAP-02 gate stream, decoded in the browser |
| `eval(uint256,bytes)` | `0x934d06ea` | on-chain evaluation used for the match check |
| `name()` / `symbol()` | standard | processor labels |

Row checks and twin scans use JSON-RPC batches (≤10 calls per batch, the public RPC limit).

Processor contracts used:
- `0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6` (FAB-Genisis / CPU)
- `0x69f663931209096037474d7c20402232e5c762ca` (TAPELIQUID / TAPE)
- `0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355` (OrderGuard / OGD)

## Who it is for
1. **Circuit buyers and integrators.** Before they rely on a circuit, they want to know what it computes and that the on-chain processor agrees.
2. **Circuit designers and Proof-of-Design miners** who want a shareable, visual page for each circuit they publish.
3. **Newcomers from Web2.** "Flip a switch, watch the gates, check it on-chain" is the shortest path to understanding TapeOut.

## Business model
- **Free explorer** (this app) as the acquisition layer.
- **Embeddable verification badge** (working today as `badge.html`) for marketplaces and project pages: "matches the published spec on all 16 input rows at X Layer block N". Free with a TapeLens link; white-label and spec hosting priced per domain per month.
- **Verification API** for apps that call circuits from their own backends: batch truth tables, regression checks when a circuit is re-minted, alerts on mismatches. Usage-based tiers.

## Run locally
It is a static site with no build step and no dependencies:
```
python -m http.server 8000   # then open http://localhost:8000
```

## Notes
- Circuits with state (LATCH, `nState > 0`) cannot use `eval()` on-chain. TapeLens shows a local single-tick view and labels it clearly.
- Drawing is capped at the first 400 gates. Simulation and truth tables use the full netlist.
- Nothing is signed or sent. TapeLens never asks for a wallet.
