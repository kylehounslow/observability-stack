// HTTP service with no OTel SDK. Logs the traceparent it receives, calls each URL in CALLS in parallel,
// then answers with the response from UPSTREAM (same method, path, and body) or "ok" if UPSTREAM is unset.
package main

import (
	"bytes"
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Side calls sit on the caller's request path but their results are discarded, so keep them short.
const callTimeout = time.Second

func main() {
	client := &http.Client{Timeout: 5 * time.Second}
	upstream := os.Getenv("UPSTREAM")
	var calls []string
	for _, c := range strings.Split(os.Getenv("CALLS"), ",") {
		if c = strings.TrimSpace(c); c != "" {
			calls = append(calls, c)
		}
	}
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("recv path=%s traceparent=%q", r.URL.Path, r.Header.Get("traceparent"))
		var wg sync.WaitGroup
		for _, u := range calls {
			wg.Add(1)
			go func(u string) {
				defer wg.Done()
				ctx, cancel := context.WithTimeout(r.Context(), callTimeout)
				defer cancel()
				req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
				if err != nil {
					log.Printf("call %s: %v", u, err)
					return
				}
				resp, err := client.Do(req)
				if err != nil {
					log.Printf("call %s: %v", u, err)
					return
				}
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}(u)
		}
		wg.Wait()
		if upstream == "" {
			w.Write([]byte("ok"))
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), r.Method, upstream+r.URL.RequestURI(), bytes.NewReader(body))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if ct := r.Header.Get("Content-Type"); ct != "" {
			req.Header.Set("Content-Type", ct)
		}
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("upstream %s: %v", upstream, err)
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		if ct := resp.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})
	log.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"), nil))
}
