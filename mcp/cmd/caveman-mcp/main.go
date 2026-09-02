// Command caveman-mcp is the Caveman MCP server. The default transport is
// stdio — an MCP host (Claude Code, Cursor, …) spawns it and speaks JSON-RPC on
// stdin/stdout. With `-http <addr>` it serves the SAME server over the MCP
// streamable-HTTP transport on the given address (e.g. `-http :8080`), so a
// remote host can reach the caveman_* tools without a parallel Node server
// (upstream review #934: the Go binary is the architectural owner of MCP). Logs
// go to stderr only — stdout is the protocol channel on stdio.
//
// By default it opens the SHARED file recovery store (CAVEMAN_CCR_DB, else
// ~/.caveman/ccr.db) — the same store the Caveman gateway writes — so a
// caveman_retrieve here resolves handles the proxy disclosed (this is what lets a
// wrapped agent recover proxy-elided detail on streaming requests). Set
// CAVEMAN_MCP_EPHEMERAL=1 for a fresh in-memory store that touches no disk.
package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/JuliusBrussee/caveman/engine"
	"github.com/JuliusBrussee/caveman/engine/ccr"
	"github.com/JuliusBrussee/caveman/mcp"
)

var version = "dev"

func main() {
	rest, addr, wantHTTP := splitHTTPFlag(os.Args[1:])
	if handled, code := handleArgs(rest, os.Stdout, os.Stderr); handled {
		os.Exit(code)
	}
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	store, err := openRecoveryStore()
	if err != nil {
		logger.Error("open recovery store", "err", err)
		os.Exit(1)
	}
	defer store.Close()

	eng := engine.New(store, nil)
	srv := mcp.NewServerVersion("caveman", version, mcp.EngineTools(eng, logger), logger)

	if wantHTTP {
		logger.Info("serving MCP over streamable HTTP", "addr", addr)
		if err := srv.StartHTTP(addr); err != nil {
			logger.Error("http serve", "err", err)
			os.Exit(1)
		}
		return
	}
	if err := srv.Serve(os.Stdin, os.Stdout); err != nil {
		logger.Error("serve", "err", err)
		os.Exit(1)
	}
}

// splitHTTPFlag scans args once for `-http [addr]`, returning the remaining
// args (the flag and its address removed) and the address to serve. A bare
// `-http` (no following arg) defaults to a loopback address; when the flag is
// absent, args is returned unchanged. The first `-http` wins the address; every
// `-http` pair is removed so handleArgs only ever sees what it understands.
func splitHTTPFlag(args []string) (rest []string, addr string, wantHTTP bool) {
	rest = make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		if args[i] == "-http" {
			if !wantHTTP {
				if i+1 < len(args) {
					addr = args[i+1]
				} else {
					addr = "127.0.0.1:8931"
				}
				wantHTTP = true
			}
			i++ // skip the flag's address
			continue
		}
		rest = append(rest, args[i])
	}
	return rest, addr, wantHTTP
}

func handleArgs(args []string, stdout, stderr io.Writer) (bool, int) {
	if len(args) == 0 {
		return false, 0
	}
	if len(args) == 2 && args[0] == "version" && args[1] == "--json" {
		err := json.NewEncoder(stdout).Encode(map[string]any{
			"version":      version,
			"schema":       "caveman.mcp.version.v1",
			"capabilities": []string{"mcp_recovery", "build_stamped_version", "http_transport"},
		})
		if err != nil {
			return true, 1
		}
		return true, 0
	}
	_, _ = io.WriteString(stderr, "usage: caveman-mcp [version --json | -http <addr>]\n")
	return true, 2
}

// openRecoveryStore opens the shared file CCR store the proxy uses, so handles are
// resolvable across processes. CAVEMAN_MCP_EPHEMERAL=1 forces an in-memory store
// (no disk). The path mirrors the proxy: CAVEMAN_CCR_DB, else ~/.caveman/ccr.db.
func openRecoveryStore() (*ccr.Store, error) {
	if os.Getenv("CAVEMAN_MCP_EPHEMERAL") == "1" {
		return ccr.OpenMemory()
	}
	path := os.Getenv("CAVEMAN_CCR_DB")
	if path == "" {
		home := os.Getenv("CAVEMAN_HOME")
		if home == "" {
			h, err := os.UserHomeDir()
			if err != nil {
				return ccr.OpenMemory()
			}
			home = filepath.Join(h, ".caveman")
		}
		path = filepath.Join(home, "ccr.db")
	}
	return ccr.Open(path)
}
