package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// httpPost sends one JSON-RPC message over the streamable-HTTP transport and
// returns the decoded HTTP response.
func httpPost(t *testing.T, srv *httptest.Server, body string) (*http.Response, []byte) {
	t.Helper()
	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp, b
}

func httpDecode(t *testing.T, b []byte) respOut {
	t.Helper()
	var r respOut
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatalf("decode response (%v): %q", err, b)
	}
	if r.JSONRPC != "2.0" {
		t.Fatalf("missing jsonrpc 2.0: %q", b)
	}
	return r
}

func newHTTPServer(t *testing.T, eng Engine) *httptest.Server {
	t.Helper()
	srv := NewServer("caveman", EngineTools(eng, nil), nil)
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return ts
}

func TestHTTPInitialize(t *testing.T) {
	ts := newHTTPServer(t, mockEngine{})
	resp, b := httpPost(t, ts, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d body=%q", resp.StatusCode, b)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type=%q want application/json", ct)
	}
	r := httpDecode(t, b)
	if r.Error != nil {
		t.Fatalf("initialize errored: %+v", r.Error)
	}
	var res struct {
		ProtocolVersion string `json:"protocolVersion"`
		ServerInfo      struct {
			Name string `json:"name"`
		} `json:"serverInfo"`
	}
	if err := json.Unmarshal(r.Result, &res); err != nil {
		t.Fatalf("decode initialize result: %v", err)
	}
	if res.ProtocolVersion != "2024-11-05" {
		t.Fatalf("protocolVersion=%q", res.ProtocolVersion)
	}
	if res.ServerInfo.Name != "caveman" {
		t.Fatalf("serverInfo.name=%q", res.ServerInfo.Name)
	}
}

func TestHTTPToolsList(t *testing.T) {
	ts := newHTTPServer(t, mockEngine{})
	_, b := httpPost(t, ts, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	r := httpDecode(t, b)
	var res struct {
		Tools []struct {
			Name string `json:"name"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(r.Result, &res); err != nil {
		t.Fatalf("decode tools/list: %v", err)
	}
	if len(res.Tools) != 5 {
		t.Fatalf("want 5 tools, got %d", len(res.Tools))
	}
}

// TestHTTPToolCallRoundTrip drives a real compress through the transport: the
// same dispatch, engine, and result cap the stdio server uses. The repetitive
// JSON input is the proven compressible shape from the stdio full-cycle test.
func TestHTTPToolCallRoundTrip(t *testing.T) {
	ts := newHTTPServer(t, realEngine(t))
	input := `{"items":[` + strings.Repeat(`{"k":"v","n":1},`, 50) + `{"k":"v","n":1}]}`
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": 3, "method": "tools/call",
		"params": map[string]any{"name": "caveman_compress", "arguments": map[string]any{"input": input}},
	})
	_, b := httpPost(t, ts, string(body))
	r := httpDecode(t, b)
	if r.Error != nil {
		t.Fatalf("tools/call errored: %+v", r.Error)
	}
	tr := decodeTool(t, r.Result)
	if tr.IsError {
		t.Fatalf("compress returned isError: %s", tr.Content[0].Text)
	}
	var payload struct {
		RecoveryHandle *string `json:"recovery_handle"`
		Ratio          float64 `json:"ratio"`
	}
	if err := json.Unmarshal([]byte(tr.Content[0].Text), &payload); err != nil {
		t.Fatalf("decode compress payload: %v", err)
	}
	if payload.RecoveryHandle == nil || payload.Ratio <= 0 {
		t.Fatalf("expected a real compression with recovery handle, ratio=%v handle=%v", payload.Ratio, payload.RecoveryHandle)
	}
}

func TestHTTPBatch(t *testing.T) {
	ts := newHTTPServer(t, mockEngine{})
	resp, b := httpPost(t, ts, `[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d body=%q", resp.StatusCode, b)
	}
	var arr []respOut
	if err := json.Unmarshal(b, &arr); err != nil {
		t.Fatalf("batch response not an array (%v): %q", err, b)
	}
	if len(arr) != 2 {
		t.Fatalf("want 2 responses, got %d", len(arr))
	}
}

func TestHTTPNotificationGetsNoReply(t *testing.T) {
	ts := newHTTPServer(t, mockEngine{})
	resp, b := httpPost(t, ts, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status=%d want 202", resp.StatusCode)
	}
	if len(bytes.TrimSpace(b)) != 0 {
		t.Fatalf("notification reply should be empty, got %q", b)
	}
}

func TestHTTPParseError(t *testing.T) {
	ts := newHTTPServer(t, mockEngine{})
	resp, b := httpPost(t, ts, `{"jsonrpc":"2.0","id":1,"method":`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", resp.StatusCode)
	}
	r := httpDecode(t, b)
	if r.Error == nil || r.Error.Code != codeParseError {
		t.Fatalf("want parse error, got %+v", r.Error)
	}
}

func TestHTTPWrongContentType(t *testing.T) {
	ts := newHTTPServer(t, mockEngine{})
	resp, err := http.Post(ts.URL, "text/plain", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("status=%d want 415", resp.StatusCode)
	}
}

func TestHTTPMethodNotAllowed(t *testing.T) {
	ts := newHTTPServer(t, mockEngine{})
	req, err := http.NewRequest(http.MethodPut, ts.URL, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d want 405", resp.StatusCode)
	}
}

func TestHTTPPayloadTooLarge(t *testing.T) {
	srv := NewServer("caveman", EngineTools(mockEngine{}, nil), nil)
	srv.maxInboundBytes = 1024 // shrink the cap so the test stays fast
	ts := httptest.NewServer(srv)
	defer ts.Close()
	big := `{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"` + strings.Repeat("x", 4096) + `"}}`
	resp, b := httpPost(t, ts, big)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", resp.StatusCode)
	}
	r := httpDecode(t, b)
	if r.Error == nil || r.Error.Message != "cave_payload_too_large: message exceeds cap" {
		t.Fatalf("want payload-too-large error, got %+v", r.Error)
	}
}

// TestHTTPSSEGet opens the GET side of the transport and expects a live
// text/event-stream that delivers heartbeats. The stream never closes by
// design (it ends on client disconnect), so reads are bounded line reads, not
// ReadAll.
func TestHTTPSSEGet(t *testing.T) {
	srv := NewServer("caveman", EngineTools(mockEngine{}, nil), nil)
	srv.heartbeat = 50 * time.Millisecond // short interval so the test is fast
	ts := httptest.NewServer(srv)
	defer ts.Close()
	req, err := http.NewRequest(http.MethodGet, ts.URL, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type=%q want text/event-stream", ct)
	}
	br := bufio.NewReader(resp.Body)
	deadline := time.After(3 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatal("SSE stream never delivered a heartbeat")
		default:
		}
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatalf("read: %v (got %q)", err, line)
		}
		if strings.Contains(line, ": ping") {
			return // first heartbeat proves the stream is live
		}
	}
}
