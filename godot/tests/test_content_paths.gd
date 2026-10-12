extends GdUnitTestSuite

var _saved_env := ""


func before_test() -> void:
	_saved_env = OS.get_environment(ContentPaths.ENV_VAR)


func after_test() -> void:
	OS.set_environment(ContentPaths.ENV_VAR, _saved_env)


func test_repo_root_is_the_folder_above_the_project() -> void:
	assert_bool(DirAccess.dir_exists_absolute(ContentPaths.repo_root().path_join("maps"))).is_true()
	assert_bool(FileAccess.file_exists(ContentPaths.repo_root().path_join("godot/project.godot"))).is_true()


func test_finds_files_in_the_repo_root_by_default() -> void:
	OS.set_environment(ContentPaths.ENV_VAR, "")
	assert_str(ContentPaths.find("maps/test_movement.map")).is_equal(ContentPaths.repo_root().path_join("maps/test_movement.map"))
	assert_str(ContentPaths.find("maps/no_such_map.map")).is_empty()


func test_content_directories_come_before_the_repo_root() -> void:
	var dir := create_temp_dir("content")
	var path := ProjectSettings.globalize_path(dir)
	DirAccess.make_dir_recursive_absolute(path.path_join("data"))
	FileAccess.open(path.path_join("data/player.json"), FileAccess.WRITE).store_string("{}")
	OS.set_environment(ContentPaths.ENV_VAR, path)
	assert_str(ContentPaths.roots()[0]).is_equal(path.simplify_path())
	assert_str(ContentPaths.find("data/player.json")).is_equal(path.simplify_path().path_join("data/player.json"))
	# Files the content directory lacks still come from the repo root.
	assert_str(ContentPaths.find("maps/test_movement.map")).is_equal(ContentPaths.repo_root().path_join("maps/test_movement.map"))
