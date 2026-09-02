package main

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
)

func TestVersionJSON(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	handled, code := handleArgs([]string{"version", "--json"}, &stdout, &stderr)
	if !handled || code != 0 {
		t.Fatalf("handled=%v code=%d stderr=%q", handled, code, stderr.String())
	}
	var got struct {
		Version      string   `json:"version"`
		Schema       string   `json:"schema"`
		Capabilities []string `json:"capabilities"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if got.Version != version {
		t.Fatalf("version=%q want %q", got.Version, version)
	}
	if got.Schema != "caveman.mcp.version.v1" {
		t.Fatalf("schema=%q", got.Schema)
	}
	if len(got.Capabilities) != 3 || got.Capabilities[0] != "mcp_recovery" {
		t.Fatalf("capabilities=%v", got.Capabilities)
	}
	if got.Capabilities[2] != "http_transport" {
		t.Fatalf("capabilities=%v want http_transport last", got.Capabilities)
	}
}

func TestUnknownArgumentExitsTwo(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	handled, code := handleArgs([]string{"unknown"}, &stdout, &stderr)
	if !handled || code != 2 {
		t.Fatalf("handled=%v code=%d", handled, code)
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout=%q", stdout.String())
	}
	if stderr.String() != "usage: caveman-mcp [version --json | -http <addr>]\n" {
		t.Fatalf("stderr=%q", stderr.String())
	}
}

func TestNoArgumentsStartsServer(t *testing.T) {
	handled, code := handleArgs(nil, &bytes.Buffer{}, &bytes.Buffer{})
	if handled || code != 0 {
		t.Fatalf("handled=%v code=%d", handled, code)
	}
}

func TestSplitHTTPFlag(t *testing.T) {
	cases := []struct {
		name     string
		args     []string
		wantRest []string
		wantAddr string
		wantHTTP bool
	}{
		{"normal -http <addr>", []string{"-http", "127.0.0.1:9000"}, []string{}, "127.0.0.1:9000", true},
		{"flag stripped, trailing args kept", []string{"-http", ":8080", "version", "--json"}, []string{"version", "--json"}, ":8080", true},
		{"bare -http defaults to loopback", []string{"-http"}, []string{}, "127.0.0.1:8931", true},
		{"absent flag leaves args unchanged", []string{"version", "--json"}, []string{"version", "--json"}, "", false},
		{"no args", nil, []string{}, "", false},
		{"repeated -http: first wins, all pairs removed", []string{"-http", "a", "-http", "b"}, []string{}, "a", true},
		{"-http -http consumes second as address", []string{"-http", "-http"}, []string{}, "-http", true},
		{"flag mid-args keeps siblings", []string{"foo", "-http", ":9000", "bar"}, []string{"foo", "bar"}, ":9000", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rest, addr, wantHTTP := splitHTTPFlag(tc.args)
			if !reflect.DeepEqual(rest, tc.wantRest) {
				t.Fatalf("rest=%v want %v", rest, tc.wantRest)
			}
			if addr != tc.wantAddr {
				t.Fatalf("addr=%q want %q", addr, tc.wantAddr)
			}
			if wantHTTP != tc.wantHTTP {
				t.Fatalf("wantHTTP=%v want %v", wantHTTP, tc.wantHTTP)
			}
		})
	}
}
