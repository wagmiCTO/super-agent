package main

import (
	"context"

	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/store"
)

// keyBackend adapts the store to the keys package's Backend.
type keyBackend struct{ st *store.Store }

func (b keyBackend) LoadKeys(ctx context.Context) ([]keys.Key, error) {
	recs, err := b.st.Keys(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]keys.Key, 0, len(recs))
	for _, r := range recs {
		out = append(out, keys.Key{
			Address: r.Address, Strategy: r.Strategy, APIKey: r.APIKey, PrivateKey: r.PrivateKey, Label: r.Label,
			BuilderID: r.BuilderID, MaxBuilderFeePer100K: r.MaxBuilderFeePer100K, MaxBuilderFeePct: r.MaxBuilderFeePct,
			Derived: r.Derived, EnrolledAt: r.EnrolledAt,
		})
	}
	return out, nil
}

func (b keyBackend) PutKey(ctx context.Context, k keys.Key) error {
	return b.st.PutKey(ctx, store.KeyRecord{
		Address: k.Address, Strategy: k.Strategy, APIKey: k.APIKey, PrivateKey: k.PrivateKey, Label: k.Label,
		BuilderID: k.BuilderID, MaxBuilderFeePer100K: k.MaxBuilderFeePer100K, MaxBuilderFeePct: k.MaxBuilderFeePct,
		Derived: k.Derived, EnrolledAt: k.EnrolledAt,
	})
}

func (b keyBackend) DeleteKey(ctx context.Context, address, strategy string) error {
	return b.st.DeleteKey(ctx, address, strategy)
}

// policyPersister adapts the store to the policy engine's Persister.
type policyPersister struct{ st *store.Store }

func (p policyPersister) SaveAccount(ctx context.Context, a policy.AccountState) error {
	return p.st.SavePolicyAccount(ctx, store.PolicyAccount{
		Account: a.Account, DayStart: a.DayStart, RealizedLoss: a.RealizedLoss, LastOpen: a.LastOpen, OpenPositions: a.OpenPositions, Exposure: a.Exposure,
	})
}

func (p policyPersister) SaveKill(ctx context.Context, killed bool, note string) error {
	return p.st.SaveKill(ctx, killed, note)
}

// restorePolicy loads the engine's persisted state and turns write-through on.
func restorePolicy(ctx context.Context, eng *policy.Engine, st *store.Store) error {
	accounts, err := st.PolicyAccounts(ctx)
	if err != nil {
		return err
	}
	states := make([]policy.AccountState, 0, len(accounts))
	for _, a := range accounts {
		states = append(states, policy.AccountState{
			Account: a.Account, DayStart: a.DayStart, RealizedLoss: a.RealizedLoss, LastOpen: a.LastOpen, OpenPositions: a.OpenPositions, Exposure: a.Exposure,
		})
	}
	killed, note, err := st.Kill(ctx)
	if err != nil {
		return err
	}
	eng.Restore(states, killed, note)
	eng.Persist(policyPersister{st})
	return nil
}
