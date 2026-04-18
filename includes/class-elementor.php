<?php
/**
 * Registers Elementor widget for the 3D Configurator.
 */

class CONFIGURATOR_Elementor
{
    private const CONFIGURATOR_OPTIONS_CACHE_KEY = 'configurator_elementor_options';

    public static function init()
    {
        add_action('elementor/widgets/register', [self::class, 'register_widget']);
        add_action('save_post_' . CONFIGURATOR_POST_TYPE, [self::class, 'clear_widget_cache']);
        add_action('deleted_post', [self::class, 'clear_widget_cache_for_post']);
    }

    public static function register_widget($widgets_manager)
    {
        if (!class_exists('\Elementor\Widget_Base')) {
            return;
        }

        require_once CONFIGURATOR_PATH . 'includes/class-elementor-widget.php';
        $widgets_manager->register(new CONFIGURATOR_Elementor_Widget());
    }

    public static function get_cached_configurator_options()
    {
        $options = get_transient(self::CONFIGURATOR_OPTIONS_CACHE_KEY);
        if ($options !== false) {
            return $options;
        }

        $configs = get_posts([
            'post_type' => CONFIGURATOR_POST_TYPE,
            'posts_per_page' => -1,
            'post_status' => 'publish',
        ]);

        $options = ['' => 'Select a configurator'];
        foreach ($configs as $config) {
            $options[$config->ID] = $config->post_title;
        }

        set_transient(self::CONFIGURATOR_OPTIONS_CACHE_KEY, $options, HOUR_IN_SECONDS);

        return $options;
    }

    public static function clear_widget_cache()
    {
        delete_transient(self::CONFIGURATOR_OPTIONS_CACHE_KEY);
    }

    public static function clear_widget_cache_for_post($post_id)
    {
        if (get_post_type($post_id) === CONFIGURATOR_POST_TYPE) {
            self::clear_widget_cache();
        }
    }
}
