package mcp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// MCP streamable-HTTP transport (2025-06-18 spec) for the same Server the stdio
// adapter serves. One HTTP endpoint; JSON-RPC messages arrive via POST, and
// server→client messages — none exist for this tool set, since every tool is
// request/response — would flow over an SSE stream opened by GET.
//
// This exists so the architectural owner (the Go caveman-mcp) can serve remote
// hosts instead of a parallel Node server (upstream review #934): the transport
// reuses the exact same Server, dispatch, tool set, size caps, and fail-closed
// semantics as stdio. No sessions are managed (the server is stateless and never
// sends unsolicited messages), so no Mcp-Session-Id header is emitted — clients
// that require sessions will see a normal JSON-RPC initialize reply and can
// decide; the transport never claims semantics it does not provide.
//
// CORS is permissive on purpose: MCP clients (Claude Desktop, remote hosts)
// connect from arbitrary origins and there is no cookie/credential state to
// protect — the endpoint is authenticated by deployment (bind address / proxy),
// not by the browser.

// ServeHTTP implements http.Handler. Methods:
//
//	POST /  — one JSON-RPC message (single or batch); replied with application/json
//	GET  /  — SSE stream (heartbeats only; kept open until the client disconnects)
//	OPTIONS — CORS preflight
//
// Anything else is 405 Method Not Allowed.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	switch r.Method {
	case http.MethodOptions:
		w.WriteHeader(http.StatusNoContent)
	case http.MethodPost:
		s.serveHTTPPost(w, r)
	case http.MethodGet:
		s.serveHTTPGet(w, r)
	default:
		w.Header().Set("Allow", "GET, POST, OPTIONS")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func setCORS(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "content-type, accept, mcp-session-id, mcp-protocol-version")
	h.Set("Access-Control-Expose-Headers", "mcp-session-id")
}

func (s *Server) serveHTTPPost(w http.ResponseWriter, r *http.Request) {
	ct := r.Header.Get("Content-Type")
	if ct != "" && !strings.HasPrefix(strings.ToLower(ct), "application/json") {
		http.Error(w, "content-type must be application/json", http.StatusUnsupportedMediaType)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, int64(s.maxInboundBytes)+1))
	if err != nil {
		http.Error(w, "could not read request body", http.StatusBadRequest)
		return
	}
	if len(body) > s.maxInboundBytes {
		s.writeHTTPJSON(w, http.StatusBadRequest,
			errorResponse(nil, codeInvalidRequest, "cave_payload_too_large: message exceeds cap"))
		return
	}
	raw := bytes.TrimSpace(body)
	if len(raw) == 0 {
		s.writeHTTPJSON(w, http.StatusBadRequest,
			errorResponse(nil, codeInvalidRequest, "empty request body"))
		return
	}

	if raw[0] == '[' {
		s.serveHTTPBatch(w, raw)
		return
	}
	var req rpcRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		s.log.Warn("http decode request", "err", err)
		s.writeHTTPJSON(w, http.StatusBadRequest, errorResponse(nil, codeParseError, "parse error"))
		return
	}
	resp, isNotif := s.serveOne(req)
	if isNotif {
		// A notification gets no reply; the request is done.
		w.WriteHeader(http.StatusAccepted)
		return
	}
	s.writeHTTPJSON(w, http.StatusOK, resp)
}

func (s *Server) serveHTTPBatch(w http.ResponseWriter, raw []byte) {
	var raws []json.RawMessage
	if err := json.Unmarshal(raw, &raws); err != nil {
		s.log.Warn("http decode batch", "err", err)
		s.writeHTTPJSON(w, http.StatusBadRequest, errorResponse(nil, codeParseError, "parse error"))
		return
	}
	if len(raws) == 0 {
		s.writeHTTPJSON(w, http.StatusBadRequest, errorResponse(nil, codeInvalidRequest, "empty batch"))
		return
	}
	responses := make([]rpcResponse, 0, len(raws))
	for _, rawMsg := range raws {
		var req rpcRequest
		if err := json.Unmarshal(rawMsg, &req); err != nil {
			responses = append(responses, errorResponse(nil, codeInvalidRequest, "invalid request in batch"))
			continue
		}
		resp, isNotif := s.serveOne(req)
		if isNotif {
			continue
		}
		responses = append(responses, resp)
	}
	if len(responses) == 0 {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	b, err := json.Marshal(responses)
	if err != nil {
		s.writeHTTPJSON(w, http.StatusInternalServerError,
			errorResponse(nil, codeInternalError, "cave_internal_error"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

// serveHTTPGet opens the SSE side of the transport. This tool set emits no
// server-initiated messages, so the stream carries only spec heartbeats and
// stays open until the client disconnects (request context done) — which is
// what a compliant MCP client expects after opening the GET connection.
func (s *Server) serveHTTPGet(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ticker := time.NewTicker(s.heartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			// SSE comment heartbeat keeps intermediaries and clients from
			// treating the idle stream as dead.
			_, _ = io.WriteString(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func (s *Server) writeHTTPJSON(w http.ResponseWriter, status int, resp rpcResponse) {
	b, err := json.Marshal(resp)
	if err != nil {
		http.Error(w, "cave_internal_error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

// StartHTTP runs the server over streamable HTTP on addr (e.g. ":8080") until
// the listener is closed. It exists so the CLI can offer -http with the same
// server instance the stdio path uses.
func (s *Server) StartHTTP(addr string) error {
	srv := &http.Server{
		Addr:              addr,
		Handler:           s,
		ReadHeaderTimeout: 30 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("http serve: %w", err)
	}
	return nil
}
