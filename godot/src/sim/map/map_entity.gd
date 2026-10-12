class_name MapEntity
extends RefCounted
## A .map entity: key/value properties and any brushes (each a list of MapFace).

var properties: Dictionary[String, String] = {}
## Each brush is an Array[MapFace].
var brushes: Array[Array] = []
