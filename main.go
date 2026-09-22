package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The panel is intentionally dependency-free so it can be built directly by
// Orbit/Flux without a package registry or a runtime install step.
//
//go:embed web/*
var webFiles embed.FS
var webAssets fs.FS

func init() {
	var err error
	webAssets, err = fs.Sub(webFiles, "web")
	if err != nil {
		panic(err)
	}
}

const (
	sessionCookieName = "traffic_bridge_panel"
	sessionLifetime   = 12 * time.Hour
)

type config struct {
	Port                 string
	PanelPassword        string
	SessionSecret        string
	StateFile            string
	ShadURL              string
	BridgeEnableCommand  string
	BridgeDisableCommand string
	CookieSecure         bool
}

type persistedState struct {
	ShadReady         bool      `json:"shadReady"`
	ShadReadyAt       time.Time `json:"shadReadyAt,omitempty"`
	ConnectionEnabled bool      `json:"connectionEnabled"`
	ConnectionState   string    `json:"connectionState"`
	LastError         string    `json:"lastError,omitempty"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type activationRequest struct {
	Enabled bool `json:"enabled"`
}

type server struct {
	config config
	mu     sync.RWMutex
	state  persistedState
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	s := &server{config: cfg}
	if err := s.loadState(); err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleRoot)
	mux.HandleFunc("/login", s.handleLogin)
	mux.HandleFunc("/logout", s.handleLogout)
	mux.Handle("/assets/", http.StripPrefix("/assets/", http.FileServer(http.FS(webAssets))))
	mux.Handle("/api/status", s.authenticated(http.HandlerFunc(s.handleStatus)))
	mux.Handle("/api/shad/mark-ready", s.authenticated(http.HandlerFunc(s.handleShadReady)))
	mux.Handle("/api/connection/toggle", s.authenticated(http.HandlerFunc(s.handleConnectionToggle)))

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           withSecurityHeaders(withRequestLog(mux)),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      90 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	log.Printf("Traffic Bridge server panel listening on :%s", cfg.Port)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func loadConfig() (config, error) {
	cfg := config{
		Port:                 envOr("PORT", "2053"),
		PanelPassword:        os.Getenv("PANEL_PASSWORD"),
		SessionSecret:        os.Getenv("SESSION_SECRET"),
		StateFile:            envOr("STATE_FILE", "/app/data/state.json"),
		ShadURL:              envOr("SHAD_URL", "https://web.shad.ir"),
		BridgeEnableCommand:  os.Getenv("BRIDGE_ENABLE_COMMAND"),
		BridgeDisableCommand: os.Getenv("BRIDGE_DISABLE_COMMAND"),
		CookieSecure:         envBool("COOKIE_SECURE", false),
	}

	if cfg.PanelPassword == "" {
		return config{}, errors.New("PANEL_PASSWORD is required")
	}
	if cfg.SessionSecret == "" {
		return config{}, errors.New("SESSION_SECRET is required")
	}
	if len(cfg.SessionSecret) < 32 {
		return config{}, errors.New("SESSION_SECRET must be at least 32 characters")
	}
	if cfg.Port == "" {
		return config{}, errors.New("PORT must not be empty")
	}
	return cfg, nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func (s *server) loadState() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.state = persistedState{
		ConnectionState: "offline",
		UpdatedAt:       time.Now().UTC(),
	}

	data, err := os.ReadFile(s.config.StateFile)
	if errors.Is(err, os.ErrNotExist) {
		return s.persistStateLocked()
	}
	if err != nil {
		return fmt.Errorf("read state file: %w", err)
	}
	if err := json.Unmarshal(data, &s.state); err != nil {
		return fmt.Errorf("decode state file: %w", err)
	}
	if s.state.ConnectionState == "" {
		s.state.ConnectionState = "offline"
	}
	return nil
}

func (s *server) persistStateLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.config.StateFile), 0700); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}

	tempFile := s.config.StateFile + ".tmp"
	if err := os.WriteFile(tempFile, data, 0600); err != nil {
		return fmt.Errorf("write state file: %w", err)
	}
	if err := os.Rename(tempFile, s.config.StateFile); err != nil {
		return fmt.Errorf("replace state file: %w", err)
	}
	return nil
}

func (s *server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	if !s.hasSession(r) {
		s.servePage(w, "login.html")
		return
	}
	s.servePage(w, "index.html")
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		if s.hasSession(r) {
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		s.servePage(w, "login.html")
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}
	password := r.FormValue("password")
	if !secureStringEqual(password, s.config.PanelPassword) {
		http.Error(w, "رمز ورود نادرست است.", http.StatusUnauthorized)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    makeSessionValue(s.config.SessionSecret),
		Path:     "/",
		MaxAge:   int(sessionLifetime.Seconds()),
		HttpOnly: true,
		Secure:   s.config.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.config.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

func (s *server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	s.mu.RLock()
	state := s.state
	s.mu.RUnlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"shad": map[string]any{
			"ready":   state.ShadReady,
			"readyAt": state.ShadReadyAt,
			"url":     s.config.ShadURL,
		},
		"connection": map[string]any{
			"enabled": state.ConnectionEnabled,
			"state":   state.ConnectionState,
			"error":   state.LastError,
		},
		"updatedAt": state.UpdatedAt,
	})
}

func (s *server) handleShadReady(w http.ResponseWriter, r *http.Request) {
	if !sameOriginRequest(r) {
		http.Error(w, "origin rejected", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	s.state.ShadReady = true
	s.state.ShadReadyAt = time.Now().UTC()
	s.state.LastError = ""
	s.state.UpdatedAt = time.Now().UTC()
	err := s.persistStateLocked()
	state := s.state
	s.mu.Unlock()
	if err != nil {
		http.Error(w, "ذخیرهٔ وضعیت ورود شاد انجام نشد.", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": state})
}

func (s *server) handleConnectionToggle(w http.ResponseWriter, r *http.Request) {
	if !sameOriginRequest(r) {
		http.Error(w, "origin rejected", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request activationRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 8*1024)).Decode(&request); err != nil {
		http.Error(w, "بدنهٔ درخواست نامعتبر است.", http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	ready := s.state.ShadReady
	current := s.state.ConnectionEnabled
	s.mu.RUnlock()
	if request.Enabled && !ready {
		writeJSON(w, http.StatusConflict, map[string]string{
			"code":    "shad_login_required",
			"message": "ابتدا ورود به شاد را تکمیل و وضعیت آن را تأیید کنید.",
		})
		return
	}
	if request.Enabled == current {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "unchanged": true})
		return
	}

	command := s.config.BridgeDisableCommand
	nextState := "stopping"
	if request.Enabled {
		command = s.config.BridgeEnableCommand
		nextState = "starting"
	}
	if strings.TrimSpace(command) == "" {
		s.updateConnectionState("error", fmt.Sprintf("دستور %s ارتباط در تنظیمات سرور تعریف نشده است.", map[bool]string{true: "فعال‌سازی", false: "غیرفعال‌سازی"}[request.Enabled]))
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"code":    "bridge_command_not_configured",
			"message": "دستور واقعی ارتباط هنوز در تنظیمات Orbit ثبت نشده است.",
		})
		return
	}

	s.updateConnectionState(nextState, "")
	output, err := runConfiguredCommand(command)
	if err != nil {
		s.updateConnectionState("error", "اجرای دستور ارتباط ناموفق بود.")
		log.Printf("bridge command failed: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"code":    "bridge_command_failed",
			"message": "فعال‌سازی ارتباط انجام نشد؛ لاگ سرور را بررسی کنید.",
		})
		return
	}

	s.mu.Lock()
	s.state.ConnectionEnabled = request.Enabled
	s.state.ConnectionState = map[bool]string{true: "online", false: "offline"}[request.Enabled]
	s.state.LastError = ""
	s.state.UpdatedAt = time.Now().UTC()
	err = s.persistStateLocked()
	state := s.state
	s.mu.Unlock()
	if err != nil {
		http.Error(w, "ذخیرهٔ وضعیت ارتباط انجام نشد.", http.StatusInternalServerError)
		return
	}

	log.Printf("bridge command completed successfully (output bytes: %d)", len(output))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "state": state})
}

func (s *server) updateConnectionState(connectionState, lastError string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.ConnectionState = connectionState
	s.state.LastError = lastError
	s.state.UpdatedAt = time.Now().UTC()
	if err := s.persistStateLocked(); err != nil {
		log.Printf("persist transitional state: %v", err)
	}
}

func runConfiguredCommand(command string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Env = os.Environ()
	return cmd.CombinedOutput()
}

func (s *server) servePage(w http.ResponseWriter, name string) {
	data, err := webFiles.ReadFile("web/" + name)
	if err != nil {
		http.Error(w, "page unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

func (s *server) authenticated(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.hasSession(r) {
			next.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"code":    "authentication_required",
				"message": "نشست پنل منقضی شده است.",
			})
			return
		}
		http.Redirect(w, r, "/login", http.StatusSeeOther)
	})
}

func (s *server) hasSession(r *http.Request) bool {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return false
	}
	return validSessionValue(cookie.Value, s.config.SessionSecret)
}

func makeSessionValue(secret string) string {
	expiresAt := strconv.FormatInt(time.Now().Add(sessionLifetime).Unix(), 10)
	return expiresAt + "." + sessionSignature(expiresAt, secret)
}

func validSessionValue(value, secret string) bool {
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return false
	}
	expiresAt, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || time.Now().Unix() >= expiresAt {
		return false
	}
	return secureStringEqual(parts[1], sessionSignature(parts[0], secret))
}

func sessionSignature(payload, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func secureStringEqual(left, right string) bool {
	leftHash := sha256.Sum256([]byte(left))
	rightHash := sha256.Sum256([]byte(right))
	return hmac.Equal(leftHash[:], rightHash[:])
}

func sameOriginRequest(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host == r.Host
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set(
			"Content-Security-Policy",
			"default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; frame-src https://web.shad.ir; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:;",
		)
		next.ServeHTTP(w, r)
	})
}

func withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(startedAt).Round(time.Millisecond))
	})
}
