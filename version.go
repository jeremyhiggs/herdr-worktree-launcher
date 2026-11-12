package launcher

import (
	_ "embed"
	"encoding/json"
)

//go:embed package.json
var packageJSON []byte

// Version returns the version embedded from package.json.
func Version() string {
	var manifest struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(packageJSON, &manifest); err != nil {
		panic(err)
	}
	if manifest.Version == "" {
		panic("package.json has no version")
	}
	return manifest.Version
}
