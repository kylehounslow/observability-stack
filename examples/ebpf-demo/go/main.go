// HTTP service with no OTel SDK. Logs the traceparent it receives, calls each URL in CALLS,
// then answers with the response from UPSTREAM (same method, path, and body) or "ok" if UPSTREAM is unset.
package main

import (
	"bytes"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	client := &http.Client{Timeout: 5 * time.Second}
	upstream := os.Getenv("UPSTREAM")
	var calls []string
	if c := os.Getenv("CALLS"); c != "" {
		calls = strings.Split(c, ",")
	}
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("recv path=%s traceparent=%q", r.URL.Path, r.Header.Get("traceparent"))
		for _, u := range calls {
			resp, err := client.Get(u)
			if err != nil {
				log.Printf("call %s: %v", u, err)
				continue
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
		if upstream == "" {
			w.Write([]byte("ok"))
			return
		}
		body, _ := io.ReadAll(r.Body)
		req, err := http.NewRequestWithContext(r.Context(), r.Method, upstream+r.URL.RequestURI(), bytes.NewReader(body))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("upstream %s: %v", upstream, err)
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})
	log.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"), nil))
}
