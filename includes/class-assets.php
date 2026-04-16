<?php
/**
 * Handles all script and style loading for the 3D Configurator plugin.
 *
 * This class is responsible for:
 * - Loading frontend assets (3D configurator JS, model-viewer library, CSS styles)
 * - Loading admin assets for the configurator builder UI in the WordPress dashboard
 * - Ensuring the Google <model-viewer> script is loaded as an ES module
 * - Restricting admin scripts/styles to only the configurator custom post type
 * - Managing script dependencies and versioning for cache control
 *
 * This keeps all asset-related logic in one place so other parts of the plugin
 * (shortcodes, Elementor widgets, WooCommerce integration) do not need to
 * manually enqueue scripts or styles.
 */
class CONFIGURATOR_Assets
{
    public static function init()
    {
        add_filter('script_loader_tag', [self::class, 'add_module_attribute'], 10, 3);
        add_action('wp_enqueue_scripts', [self::class, 'frontend']);
        add_action('admin_enqueue_scripts', [self::class, 'admin']);
    }

    public static function add_module_attribute($tag, $handle, $src)
    {
        if (in_array($handle, ['configurator-model-viewer', 'configurator-model-viewer-admin'])) {
            return '<script type="module" src="' . esc_url($src) . '" id="' . $handle . '-js"></script>';
        }
        return $tag;
    }

    public static function frontend()
    {
        wp_enqueue_script(
            'configurator-model-viewer',
            'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js',
            [],
            null,
            true
        );

        wp_enqueue_script(
            'configurator-js',
            CONFIGURATOR_URL . 'assets/js/configurator.js',
            ['configurator-model-viewer'],
            CONFIGURATOR_VERSION,
            true
        );

        wp_enqueue_style(
            'configurator-css',
            CONFIGURATOR_URL . 'assets/css/configurator.css',
            [],
            CONFIGURATOR_VERSION
        );
    }

    public static function admin($hook)
    {
        if (!in_array($hook, ['post.php', 'post-new.php'])) {
            return;
        }

        $screen = get_current_screen();
        if (!$screen || $screen->post_type !== 'configurator') {
            return;
        }

        wp_enqueue_style(
            'configurator-admin-css',
            CONFIGURATOR_URL . 'assets/css/admin-configurator.css'
        );

        wp_enqueue_script(
            'configurator-model-viewer-admin',
            'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js',
            [],
            null,
            true
        );

        wp_enqueue_script(
            'configurator-material-scanner',
            CONFIGURATOR_URL . 'assets/js/admin-material-scanner.js',
            ['jquery', 'configurator-model-viewer-admin'],
            CONFIGURATOR_VERSION,
            true
        );

        wp_enqueue_script(
            'configurator-admin-js',
            CONFIGURATOR_URL . 'assets/js/admin-configurator.js',
            ['jquery', 'configurator-material-scanner'],
            CONFIGURATOR_VERSION,
            true
        );
    }
}