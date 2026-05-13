import { EditorPluginEntry, PluginEntry, PluginGroup, ResolvedPluginGroup, SourcedPluginEntry } from '../oscd-shell.js';
/**
 * Checks if the given object is a PluginGroup (has a `plugins` array child, no `src`/`tagName`).
 * Works for both input PluginGroup and resolved ResolvedPluginGroup.
 */
export declare function isPluginGroup(plugin: unknown): plugin is PluginGroup | ResolvedPluginGroup;
/**
 * Checks if the given object is a valid Plugin.
 * @param plugin - The object to check.
 * @returns true if the object is a Plugin, false otherwise.
 */
export declare function isPlugin(plugin: unknown): plugin is PluginEntry;
/**
 * Checks if the given object is a SourcedPlugin.
 * @param plugin - The object to check.
 * @returns true if the object is a SourcedPlugin, false otherwise.
 */
export declare function isSourcedPlugin(plugin: unknown): plugin is SourcedPluginEntry;
/**
 * Validates a Plugin object, checking for required fields and types.
 * If the plugin is invalid, it logs an error and returns undefined.
 * @param plugin - The plugin object to validate.
 * @returns The validated Plugin object or undefined if invalid.
 */
export declare function validatePlugin(plugin: unknown): PluginEntry | undefined;
/**
 * Goes through all the plugins in the PluginSet and loads any sourced plugins, replacing the src field with a tagName.
 * If a plugin does not have a tagName, it will be generated based on its src.
 * All plugins returned are validated for required fields.
 * If a sourced plugin fails to load (bad src), it will be replaced with an Error Web Component.
 * @param plugins - Array of plugins to convert.
 * @returns Array of plugins with tagName included.
 */
/**
 * Like `loadSourcedPlugins` but handles the editor array which may contain `PluginGroup` entries.
 * Groups are resolved by loading their child plugins; flat entries are loaded as-is.
 */
export declare function loadEditorPlugins(plugins: (Partial<PluginEntry | SourcedPluginEntry> | PluginGroup)[], registry: CustomElementRegistry): EditorPluginEntry[];
export declare function loadSourcedPlugins(plugins: Partial<PluginEntry | SourcedPluginEntry>[], registry: CustomElementRegistry): PluginEntry[];
