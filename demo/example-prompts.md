# REAPER MCP AI Analyzing - Example Prompts

## Basic REAPER Control

### Get Project Information
```
"Get project info"
```

### Track Operations
```
"Create a new track called 'Lead Vocal'"
```
```
"Delete track 5"
```
```
"Set track 0 name to 'Kick Drum'"
```
```
"Set track 1 volume to -6 dB"
```
```
"Set track 2 pan to 0.3 (slight right)"
```

### FX Management
```
"Get all FX on track 0"
```
```
"Add ReaEQ to track 1"
```
```
"Add Pro-Q 3 to track 0"
```
```
"Add CLA-2A compressor to track 2"
```
```
"Remove FX at index 0 from track 1"
```
```
"Get parameters of FX 0 on track 1"
```
```
"Set FX 0 parameter 0 to 0.5 on track 1"
```
```
"Disable FX 1 on track 0"
```

### Routing
```
"Create a send from track 0 to track 5 at -12 dB"
```
```
"Set track 3 output to track 6 (for subgrouping)"
```
```
"Route track 2 to master output"
```

## AI Audio Analysis

### Single Track Analysis
```
"Analyze track 0 (lead vocal) and suggest EQ settings"
```
```
"Check if the bass guitar needs compression"
```
```
"Analyze the drum bus and tell me if it's too loud"
```

### Full Mix Analysis
```
"Analyze the master mix from 0 to 30 seconds"
```
```
"Check overall mix loudness - does it meet Spotify standards?"
```
```
"Analyze the chorus section (from 45s to 60s) for frequency balance"
```

### Multi-Track Analysis
```
"Analyze tracks 0, 1, and 2 together for phase issues"
```
```
"Check the relationship between kick and bass"
```

### Advanced Analysis with Context
```
"Analyze track 0. This is a lead vocal for a pop song. Check if it needs de-essing and suggest settings."
```
```
"Analyze the master mix. Target platform is YouTube. Check loudness and dynamics."
```

## Workflow Examples

### Complete Mixing Workflow
```
"1. Get project info
 2. List all tracks
 3. Set all drum tracks (0-4) to -8 dB
 4. Add Pro-Q 3 to track 0 (kick)
 5. Analyze the drum bus for overall balance"
```

### Vocal Chain Setup
```
"1. Create a new track called 'Lead Vocal'
 2. Add CLA-76 compressor
 3. Add Pro-Q 3
 4. Set track volume to -3 dB
 5. Analyze the track for any frequency issues"
```

### Mastering Check
```
"1. Analyze master mix loudness
 2. Check if it needs limiting
 3. Suggest optimal true peak level"
```

## Tips for Best Results

1. **Be Specific**: Instead of "analyze this", say "analyze track 0 for EQ issues"

2. **Provide Context**: Tell the AI what instrument or genre you're working with

3. **Use Track Numbers**: REAPER uses 0-based indexing (track 0 is the first track)

4. **Time Ranges**: For analysis, specify time ranges in seconds (e.g., "from 0 to 30")

5. **Check Connection First**: Always start with "check REAPER connection" to ensure everything is working

## Troubleshooting Prompts

```
"Check REAPER connection"
```
```
"Get track info for track 0"  # Test basic communication
```
```
"List available FX plugins"   # See what plugins are available